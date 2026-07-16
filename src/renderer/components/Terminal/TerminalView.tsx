// 單一 xterm 實例（綁定一個 termId）。負責：掛載 xterm + fit(+可選 WebGL)、雙向接線
// （term.onData→ipc.pty.write；ipc.pty.onData→term.write）、ResizeObserver→fit+resize、
// 近似量測按鍵延遲（REQ-PERF-004）。結束狀態（exit code + 重啟）由父層以 prop 控制（REQ-TERM-006）。
//
// 面板顯隱改 group.api.setVisible（不 dispose，xterm/PTY 原地存活）後，本元件不再因 toggle 卸載，
// 故無需序列化/還原 scrollback（xterm buffer 原地保留＝等效保留畫面）。
// reflow 防禦（修「關編輯器/多終端機並排→窄欄橫幅瀑布 + 反覆重繪閃爍」與所有版面變動來源）：
//  - ResizeObserver 去抖：吞掉 re-parent/拖曳分隔條/最大化等 reflow 過程的多次中間尺寸，穩定後 fit 一次。
//  - 反震盪：fit 改變內容會讓捲軸出現/消失、host 量測尺寸回彈 ~17px；ResizeObserver 觸發時若與「上次 fit
//    的 host 尺寸」差距在捲軸容差內「且提議格數未變」，判定為 fit 自身造成的回彈、不再 fit → 斷開
//    ResizeObserver↔fit 迴圈（多終端機並排關編輯器時最明顯，實測一次關閉觸發上百次 fit 在兩尺寸間震盪 =
//    閃爍）。格數變了則照 fit——否則 <24px 的真實拖曳被吞掉、最後一列永遠裁在 status bar 下。
//  - 極窄寬守衛：reflow 瞬間 cols≈1 一律略過，避免 ConPTY 以 1 欄重繪整個畫面（窄欄橫幅瀑布）。
//  - skip-unchanged：cols/rows 未變不重複 resize。
//  - host/view overflow:hidden：裁掉 xterm 任何溢出，不把捲軸傳導到祖先容器（從源頭少一個震盪因子）。
//
// 安全：以 createSecureTerminalOptions 初始化（關閉視窗/標題回報＝防回灌注入；不掛 clipboard
// addon＝不寫剪貼簿，REQ-TERM-008）。

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { ipc } from '../../ipc/client';
import { record } from '../../../shared/perf';
import {
  createSecureTerminalOptions,
  DEFAULT_TERMINAL_THEME,
  buildTerminalFontFamily,
  clampTerminalFontSize,
} from './secureOptions';
import { useTerminalFont } from '../../theme/TerminalFontProvider';
import { classifyClipboardKey } from './clipboardKeys';
import { stripEnclosingKeycap } from './displayNormalize';
import { DRAG_PATH_MIME, formatPathsForShell } from './pathDrop';
import type { ITheme } from '@xterm/xterm';
import type { ShellKind } from '../../../shared/types';

interface Props {
  termId: string;
  /** 此終端機的 shell 種類（拖放貼路徑時決定引號策略）。 */
  shell: ShellKind;
  visible: boolean;
  /** 非 null 表示該程序已結束（顯示 exit overlay + 重啟）。 */
  exitCode: number | null;
  onRestart: () => void;
}

// reflow 中間態的極窄寬會讓 fit 提議的 cols 掉到個位數；低於此門檻一律略過 fit/resize，
// 待尺寸穩定再校正——杜絕「cols≈1 → ConPTY 以 1 欄重繪整個畫面」的窄欄橫幅瀑布。
const MIN_FIT_COLS = 8;
// ResizeObserver 去抖窗（ms）：吞掉 re-parent/拖曳/最大化等 reflow 過程的多次中間尺寸，穩定後 fit 一次。
const FIT_DEBOUNCE_MS = 60;
// 反震盪容差（px）：> 捲軸寬（~17）。ResizeObserver 回彈在此範圍內視為 fit 自身造成、不再 fit（斷迴圈）。
const RESIZE_TOLERANCE_PX = 24;
// workflow/TUI 持續輸出期間的尺寸自癒節流（ms）。ResizeObserver 與 focusin 可能都不再觸發，
// 但 ConPTY 曾短暫 resize 失敗或漂移時，仍要靠後續輸出把 xterm 的真實尺寸補送回去。
const OUTPUT_SIZE_HEAL_MS = 500;

// 淺色/暖色主題的終端機 ANSI 16 色（深色系，淺背景可讀）。xterm 內建 ANSI 是為深背景設計的「亮色」，
// 在淺/暖背景（--bg 淺）上對比極差 → Claude Code 等 TUI 的彩色輸出（含它畫的選項/標題）難瀏覽。
// 深色主題沿用 xterm 內建亮色 ANSI（現況本就可讀，不覆蓋）。色階對齊 GitHub Light 系、與 Polydesk 暖調協調。
const LIGHT_ANSI: Partial<ITheme> = {
  black: '#24292e', red: '#b53333', green: '#116329', yellow: '#8a6d00',
  blue: '#0550ae', magenta: '#8250df', cyan: '#0e7490', white: '#57606a',
  brightBlack: '#6e7781', brightRed: '#a40e26', brightGreen: '#0a5228', brightYellow: '#6b5500',
  brightBlue: '#0343a4', brightMagenta: '#6639ba', brightCyan: '#0c6188', brightWhite: '#141413',
};

/** 從 CSS var 讀目前主題色，建構 xterm ITheme（取不到則用暗色缺省）；淺/暖主題另補深色系 ANSI 調色盤。 */
function readTerminalTheme(el: HTMLElement): ITheme {
  try {
    const cs = getComputedStyle(el);
    const v = (name: string): string => cs.getPropertyValue(name).trim();
    const bg = v('--bg') || DEFAULT_TERMINAL_THEME.background;
    const fg = v('--fg') || DEFAULT_TERMINAL_THEME.foreground;
    // 淺色/暖色主題：換深色系 ANSI（否則 xterm 內建亮色 ANSI 在淺背景幾乎看不清）。
    const themeName = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
    const isLight = themeName === 'light' || themeName === 'warm';
    return {
      background: bg,
      foreground: fg,
      cursor: fg,
      selectionBackground: isLight ? 'rgba(0,0,0,0.13)' : 'rgba(127,127,127,0.35)',
      ...(isLight ? LIGHT_ANSI : {}),
    };
  } catch {
    return DEFAULT_TERMINAL_THEME;
  }
}

export function TerminalView({ termId, shell, visible, exitCode, onRestart }: Props): React.JSX.Element {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // 字型設定：建立時取當下值（ref 避免進主 effect deps 重建終端機）；變更由獨立 effect 就地套用。
  const { font } = useTerminalFont();
  const fontRef = useRef(font);
  fontRef.current = font;
  // shell 種類走 ref（同 fontRef 理由）：進主 effect deps 會 dispose 重建整個 xterm。
  const shellRef = useRef(shell);
  shellRef.current = shell;
  // exitCode 也走 ref：drop handler 在主 effect closure 內，拿不到最新 prop——已結束的終端機
  // 要拒收 drop（pty 對死程序是 no-op，照收會「顯示可放置卻靜默丟失」還搶焦點）。
  const exitCodeRef = useRef(exitCode);
  exitCodeRef.current = exitCode;
  // 近似按鍵延遲：使用者輸入時記時間戳，下一個回流的 chunk 視為回顯。
  const keyTsRef = useRef<number | null>(null);
  // 上次實際 fit 時量到的 host 尺寸；供反震盪比對（捲軸回彈在容差內就不再 fit）。
  const lastFitBoxRef = useRef<{ w: number; h: number }>({ w: -1, h: -1 });
  // 由 visible 切換（useLayoutEffect）呼叫的就地 fit；指向 useEffect 內已掛好接線的 safeFit。
  const fitNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    lastFitBoxRef.current = { w: -1, h: -1 }; // 反震盪基準：新 termId 重置

    const theme = readTerminalTheme(host);
    const term = new Terminal(createSecureTerminalOptions(theme, fontRef.current));
    // Unicode 11 寬度表：emoji 算 2 格，與 Windows ConPTY / Claude Code 一致——修「狀態列重繪
    // 錯位互蓋成亂碼」（VS Code 終端機同款配置）。失敗不致命：僅寬度回退內建 v6，功能不受影響。
    try {
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = '11';
    } catch {
      /* 寬度表註冊失敗：回退 v6 */
    }
    // 診斷 seam（比照 __pdPerf 慣例）：e2e 確定性斷言生效中的寬度表版本，不影響執行期。
    host.dataset.termUnicode = term.unicode.activeVersion;
    // 診斷 seam（同上慣例）：暴露 term 供 e2e 直接讀 buffer 內容做確定性斷言（REQ-TERM-009 keycap
    // 正規化真實鏈路驗證）。term 本就存在於 renderer 記憶體，掛到 element property 不增攻擊面。
    (host as unknown as { __pdTerm?: Terminal }).__pdTerm = term;
    // 容器底色 = xterm 實際背景色：inset 邊距與整數格 fit 的右/下剩餘空間才不會露出
    // 主題底色形成「留白框」（xterm 只能排整數 cols/rows，剩餘空隙無法靠 fit 消除）。
    if (viewRef.current && theme.background) viewRef.current.style.background = theme.background;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // WebGL 加速（可選；不支援則靜默略過，回退 canvas/DOM renderer）。
    let disposed = false;
    let webglDispose: (() => void) | null = null;
    void (async () => {
      try {
        const mod = await import('@xterm/addon-webgl');
        if (disposed) return; // 元件已卸載：勿對已 dispose 的 term loadAddon
        const addon = new mod.WebglAddon();
        addon.onContextLoss(() => addon.dispose());
        term.loadAddon(addon);
        webglDispose = () => addon.dispose();
      } catch {
        /* WebGL 不可用：略過 */
      }
    })();

    // fit + 回報尺寸給 main。極窄寬（reflow 中間態）→ 不 fit、排一次重試待尺寸穩定再校正。
    // 尺寸「一律重送」不在 renderer 去重：main 端以「實際套用成功」的尺寸去重（PtyManager.resize），
    // resize 失敗不記帳 → 下次任何 fit 自動重試——PTY↔xterm 行數才不會一次失敗永久漂移
    // （漂移＝claude 等 TUI 把底部 UI 畫在不存在的列上、滾也滾不出來，dogfood 回報）。
    let fitRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFitRetry = (): void => {
      if (fitRetryTimer) return; // single-flight
      fitRetryTimer = setTimeout(() => {
        fitRetryTimer = null;
        safeFit();
      }, 350);
    };
    const safeFit = (): void => {
      const h = hostRef.current;
      if (!h || h.offsetWidth === 0 || h.offsetHeight === 0) return;
      try {
        const dims = fit.proposeDimensions();
        // 提議無效或極窄寬（cols 掉到個位數）：略過並排重試 → 從源頭斷掉 cols≈1 的窄欄瀑布，
        // 且過渡態結束後就算 ResizeObserver 不再觸發也會自行校正（不留卡死的中間態）。
        if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < MIN_FIT_COLS) {
          scheduleFitRetry();
          return;
        }
        fit.fit();
        // 記下這次 fit 的 host 尺寸：供 ResizeObserver 反震盪比對（即使 cols 未變也更新基準）。
        lastFitBoxRef.current = { w: h.offsetWidth, h: h.offsetHeight };
        void ipc.pty.resize({ termId, cols: term.cols, rows: term.rows });
      } catch {
        /* 尺寸尚未就緒：略過本次 */
      }
    };
    fitNowRef.current = safeFit;

    // 自癒觸發點：點進終端機（focusin）就重跑 fit＋重送尺寸——若 ConPTY 尺寸曾漂移
    // （resize 失敗被吞等），使用者一互動立即校正回來。
    const onFocusIn = (): void => safeFit();
    host.addEventListener('focusin', onFocusIn);

    // ResizeObserver 去抖 + 反震盪：合併 reflow 多次事件；若新尺寸與上次 fit 的尺寸差距在捲軸容差內，
    // 判定為 fit 自身造成的回彈（捲軸出現/消失 ±17px），不再排程 fit → 斷開 ResizeObserver↔fit 震盪迴圈。
    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFit = (): void => {
      const h = hostRef.current;
      if (h) {
        const base = lastFitBoxRef.current;
        if (base.w >= 0 && Math.abs(h.offsetWidth - base.w) < RESIZE_TOLERANCE_PX && Math.abs(h.offsetHeight - base.h) < RESIZE_TOLERANCE_PX) {
          // 容差內：僅當「提議格數也沒變」才視為 fit 回彈吞掉。容差(24px) > 一列字高(~16px)，
          // 一律吞會把 <24px 的真實拖曳也吞掉 → 永不重 fit → 最後一列被裁在 status bar 下。
          // 格數沒變＝內容不會動＝安全收斂（斷迴圈）；格數變了＝真實變化，照常排程 fit。
          try {
            const dims = fitRef.current?.proposeDimensions();
            if (!dims || (dims.cols === term.cols && dims.rows === term.rows)) return;
          } catch {
            return;
          }
        }
      }
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        fitTimer = null;
        safeFit();
      }, FIT_DEBOUNCE_MS);
    };

    // 主題即時跟隨（dogfood 回報：開著終端機切主題、終端機顏色不變）：ThemeProvider 切
    // documentElement 的 [data-theme] 時重讀 CSS var → 更新 xterm theme 與容器底色。
    // 順序刻意「先 xterm 後容器」：容器有跟上＝xterm setter 沒拋錯，兩者不會脫鉤成
    // 「容器新色、字面舊色」的半套狀態。
    const applyTheme = (): void => {
      const h = hostRef.current;
      if (!h) return;
      const t = readTerminalTheme(h);
      term.options.theme = t;
      if (viewRef.current && t.background) viewRef.current.style.background = t.background;
    };
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // 輸入：term → main（高頻；標記時間戳供延遲量測）。
    const onDataDisp = term.onData((d) => {
      keyTsRef.current = performance.now();
      ipc.pty.write(termId, d);
    });

    // 輸出跟捲自癒（dogfood：claude 點「1 shell」展開 Shell details 後底部 UI 被吃掉、且 claude
    // 開 ?1003 滾輪被送給 TUI、使用者滾也滾不回來）：xterm 6 內部 isUserScrolling 旗標可能在
    // 「viewport 明明在底部」時被遺留成 true（選取拖曳自動捲動、resize/reflow 直接調 ydisp 幾何
    // 回底都不碰旗標；而 xterm 所有清旗標路徑都掛 ybase!==ydisp 守門）→ 孤兒旗標讓下一波大量
    // 輸出（TUI 展開重繪外溢）把 viewport 凍在原地。自癒不變量＝「寫入前在底部，寫入後必須仍在
    // 底部」；scrollToBottom 走公開 scrollLines 正路、會一併清掉孤兒旗標。寫入前就不在底部
    // （使用者真的在讀 scrollback）則完全不干預，不與使用者搶捲動。
    const repinIfDrifted = (): void => {
      const b = term.buffer.active;
      if (b.viewportY !== b.baseY) term.scrollToBottom();
    };
    // workflow 長時間維持焦點並持續輸出時，ResizeObserver/focusin 都可能沒有新事件；若 PTY 尺寸
    // 曾短暫漂移，Claude 等 TUI 會一直把底部畫在可視範圍外。輸出期間節流補送 xterm 當下尺寸，
    // main 端會依「實際套用成功」尺寸去重，所以正常狀態不會反覆呼叫 ConPTY resize。
    let lastOutputSizeHealAt = 0;
    let outputSizeHealTimer: ReturnType<typeof setTimeout> | null = null;
    const sendCurrentSize = (): void => {
      outputSizeHealTimer = null;
      lastOutputSizeHealAt = performance.now();
      void ipc.pty.resize({ termId, cols: term.cols, rows: term.rows });
    };
    const healSizeOnOutput = (): void => {
      const now = performance.now();
      const remaining = OUTPUT_SIZE_HEAL_MS - (now - lastOutputSizeHealAt);
      if (remaining <= 0) {
        if (outputSizeHealTimer) clearTimeout(outputSizeHealTimer);
        sendCurrentSize();
      } else if (!outputSizeHealTimer) {
        // trailing 保證：短促輸出即使落在節流窗內，最後一段也不會永久漏掉尺寸校正。
        outputSizeHealTimer = setTimeout(sendCurrentSize, remaining);
      }
    };
    // 輸出：main → term（依 termId 過濾；回流即記一次往返延遲近似值）。
    const offData = ipc.pty.onData(({ termId: t, chunk }) => {
      if (t !== termId) return;
      healSizeOnOutput();
      const buf = term.buffer.active;
      const pinned = buf.viewportY === buf.baseY;
      // 顯示層 keycap 正規化（REQ-TERM-009）：在 PTY bytes 上「無狀態」剔除 U+20E3 圍框（含前導 FE0F），
      // 讓 1️⃣2️⃣… 退化成純數字，免得 Consolas 的 U+20E3 圍框 glyph 漏出疊到相鄰字。刻意留在 bytes 層：
      // 維持 xterm 原生 Uint8Array 解碼路徑不變，不在 PTY→xterm 間插 stateful 緩衝（那會扣住輸出尾端、
      // 卡死 PSReadLine 貼上/OSC52 鏈路）。fast path 保純 ASCII 高頻路徑零拷貝。
      term.write(stripEnclosingKeycap(chunk), pinned ? repinIfDrifted : undefined);
      if (keyTsRef.current !== null) {
        record('keyLatency', performance.now() - keyTsRef.current);
        keyTsRef.current = null;
      }
    });

    // 剪貼簿：Ctrl+V / Ctrl+Shift+V / Shift+Insert 貼上；Ctrl+C / Ctrl+Shift+C 有選取時複製，
    // 無選取的 Ctrl+C 保留給終端機送 SIGINT；右鍵貼上（有選取則複製）。
    // 讀寫走 clipboard IPC（main 端 electron clipboard）——renderer 的 navigator.clipboard 讀權限被
    // REQ-SEC-001 封鎖；此為使用者手勢觸發、與 REQ-TERM-008 正交（不掛 clipboard addon、不改 secureOptions）。
    const pasteFromClipboard = (): void => {
      void ipc.clipboard
        .readText()
        .then(({ text }) => {
          if (text) term.paste(text); // term.paste 走 bracketed paste，TUI（如 Claude Code）能正確辨識為貼上
        })
        .catch(() => undefined);
    };
    const copySelection = (): void => {
      const sel = term.getSelection();
      if (sel) void ipc.clipboard.writeText({ text: sel }).catch(() => undefined);
    };

    // 阻斷 xterm 原生 paste 事件：所有貼上一律走下方 IPC 單一路徑，避免「瀏覽器原生 paste + 我們的 IPC」
    // 各貼一次＝重複貼上（Ctrl+V 於 Electron 即使在 keydown preventDefault，瀏覽器仍可能觸發原生 paste
    // event）。用 capture 階段掛在 host（xterm 的 paste 監聽在其內的 textarea＝target 階段）→ stopPropagation
    // 使該事件到不了 xterm，preventDefault 也擋掉「把文字灌進 textarea」的預設行為。
    const onNativePaste = (e: ClipboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    host.addEventListener('paste', onNativePaste, true);

    // xterm 預設 Ctrl+V→送控制字元 ^V（不貼上）。攔截判定為貼上/複製的鍵：return false 讓 xterm 不送 ^V，
    // 改由我們讀剪貼簿後 term.paste（原生 paste 已被上方阻斷，故此處是唯一貼上來源、不重複）。
    term.attachCustomKeyEventHandler((e) => {
      const action = classifyClipboardKey(e);
      if (!action) return true;
      // Ctrl+C 沒有選取時不可攔截，必須交還 xterm 送出 ^C / SIGINT。
      if (action === 'copy' && !term.hasSelection()) return true;
      e.preventDefault();
      if (action === 'paste') pasteFromClipboard();
      else copySelection();
      return false;
    });

    // 右鍵：有選取＝複製並清選取；無選取＝貼上（Windows Terminal 慣例；xterm 原生無右鍵貼上）。
    // 貼上防抖 300ms：觸控板/滑鼠驅動偶發把一次手勢送成兩個 contextmenu、或貼上非同步延遲下
    // 使用者連點 → 忠實執行會貼兩次（dogfood 回報）；0.3 秒內故意連貼兩次在終端機無真實需求。
    //
    // 右鍵手勢由本元件全權處理 → capture 階段擋下右鍵 mousedown/mouseup，不讓 xterm 把右鍵
    // 回報給開啟滑鼠模式的 TUI（如 claude 開 ?1000/1002/1003/1006）。實測（統計 15 輪、main 端
    // 計數佐證 renderer 僅送一次）：「右鍵按下/放開回報」三條小 write 緊貼 bracketed paste 時，
    // ConPTY/TUI 輸入解析偶發把貼上套用兩次＝claude 裡右鍵雙貼的病根；拿掉回報即無觸發序列。
    // contextmenu 為獨立事件不受 stopPropagation 影響；一般 shell（無滑鼠模式）行為不變。
    const suppressRightButton = (e: MouseEvent): void => {
      if (e.button === 2) {
        e.stopPropagation();
        e.preventDefault(); // 阻掉右鍵 mousedown 的預設失焦——否則 ?1004 下會多出 \e[O\e[I 焦點回報緊貼貼上（同款觸發形狀）
      }
    };
    host.addEventListener('mousedown', suppressRightButton, true);
    host.addEventListener('mouseup', suppressRightButton, true);
    let lastCtxPasteAt = 0;
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      term.focus(); // 右鍵也聚焦終端機（原由 xterm 的 mousedown 聚焦，該路徑已被上方擋下）
      if (term.hasSelection()) {
        copySelection();
        term.clearSelection();
      } else {
        const now = Date.now();
        if (now - lastCtxPasteAt < 300) return;
        lastCtxPasteAt = now;
        pasteFromClipboard();
      }
    };
    host.addEventListener('contextmenu', onContextMenu);

    // 拖放貼路徑（VS Code 慣例）：側欄檔案（自訂 MIME）或 OS 檔案（'Files'）拖進終端機 → 貼上絕對路徑
    // （依 shell 包引號，pathDrop）。刻意不吃裸 text/plain——終端機分頁拖曳排序的 payload 是 text/plain
    // 的 termId，吃了會把 termId 誤貼進終端機。掛 view（整個面板區域皆為 drop 目標）。
    const view = viewRef.current;
    // 已結束的終端機不接（不 preventDefault ＝ 不高亮、瀏覽器顯示禁止游標、drop 不觸發）。
    const acceptsDrop = (dt: DataTransfer | null): boolean =>
      exitCodeRef.current === null && !!dt && (dt.types.includes(DRAG_PATH_MIME) || dt.types.includes('Files'));
    let dragDepth = 0; // dragenter/dragleave 在子元素間會連發：計數歸零才移除高亮
    const clearDropHint = (): void => {
      dragDepth = 0;
      view?.classList.remove('pd-term-view--drop');
    };
    const onDragEnter = (e: DragEvent): void => {
      if (!acceptsDrop(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth++;
      view?.classList.add('pd-term-view--drop');
    };
    const onDragOver = (e: DragEvent): void => {
      if (!acceptsDrop(e.dataTransfer)) return;
      e.preventDefault(); // 必要：不 preventDefault 瀏覽器不觸發 drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (): void => {
      if (dragDepth > 0 && --dragDepth === 0) view?.classList.remove('pd-term-view--drop');
    };
    const onDrop = (e: DragEvent): void => {
      if (!acceptsDrop(e.dataTransfer)) return;
      e.preventDefault();
      clearDropHint();
      const dt = e.dataTransfer;
      if (!dt) return;
      const internal = dt.getData(DRAG_PATH_MIME);
      const paths = internal
        ? [internal]
        : Array.from(dt.files)
            .map((f) => ipc.fileUtils.pathForFile(f))
            .filter((p) => p.length > 0);
      const text = formatPathsForShell(paths, shellRef.current); // 含控制字元的路徑會被整條剔除
      if (!text) return;
      term.paste(text); // bracketed paste：shell/TUI 認得是貼上
      term.focus();
    };
    view?.addEventListener('dragenter', onDragEnter);
    view?.addEventListener('dragover', onDragOver);
    view?.addEventListener('dragleave', onDragLeave);
    view?.addEventListener('drop', onDrop);

    const ro = new ResizeObserver(() => scheduleFit());
    ro.observe(host);
    // 初次 fit（下一幀，確保 DOM 已量得尺寸）。
    const raf = requestAnimationFrame(safeFit);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (fitTimer) clearTimeout(fitTimer);
      if (fitRetryTimer) clearTimeout(fitRetryTimer);
      if (outputSizeHealTimer) clearTimeout(outputSizeHealTimer);
      themeObserver.disconnect();
      ro.disconnect();
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('contextmenu', onContextMenu);
      host.removeEventListener('mousedown', suppressRightButton, true);
      host.removeEventListener('mouseup', suppressRightButton, true);
      host.removeEventListener('paste', onNativePaste, true);
      view?.removeEventListener('dragenter', onDragEnter);
      view?.removeEventListener('dragover', onDragOver);
      view?.removeEventListener('dragleave', onDragLeave);
      view?.removeEventListener('drop', onDrop);
      clearDropHint();
      onDataDisp.dispose();
      offData();
      fitNowRef.current = () => {};
      webglDispose?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [termId]);

  // 字型設定即時跟隨（設定面板改字型/字級 → 開啟中的終端機就地套用；cell 尺寸變了須重 fit）。
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const apply = (): void => {
      term.options.fontFamily = buildTerminalFontFamily(font.family);
      term.options.fontSize = clampTerminalFontSize(font.size);
      fitNowRef.current(); // 走同一條 safeFit（含極窄寬守衛）
    };
    // 打包字型（JetBrains Mono 等）是 @font-face lazy load：webgl renderer 首次量測需字型 ready，否則
    // 用 fallback 量測且不會自動重繪 → 先確保載入再套用（載入失敗也 fallback 套用，不卡）。
    if (typeof document !== 'undefined' && document.fonts?.load) {
      void document.fonts.load(`${clampTerminalFontSize(font.size)}px "${font.family}"`).then(apply).catch(apply);
    } else {
      apply();
    }
  }, [font]);

  // 由隱藏切回顯示時重新 fit + 聚焦（display:none 時容器尺寸為 0，無法 fit）。
  useLayoutEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    if (!host || host.offsetWidth === 0 || host.offsetHeight === 0) return;
    fitNowRef.current(); // 走同一條 safeFit（含極窄寬守衛 + 更新反震盪基準）
    termRef.current?.focus();
  }, [visible, termId]);

  return (
    <div
      ref={viewRef}
      className="pd-term-view"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: visible ? 'block' : 'none' }}
      role="group"
      aria-label="終端機輸出"
      aria-hidden={!visible}
    >
      {/* 邊距用 inset 而非 padding：Chromium 在 border-box 下 getComputedStyle().height 回傳含 padding
          的值，FitAddon 以此量可用高度會把 padding 也算進去 → 多排一列、最後一列被裁掉。 */}
      <div ref={hostRef} style={{ position: 'absolute', inset: 'var(--space-2)', overflow: 'hidden' }} />
      {exitCode !== null && (
        <div
          className="pd-term-exit"
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in oklab, var(--bg), transparent 12%)',
            color: 'var(--fg-2)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <span>處理程序已結束（exit code {exitCode}）</span>
          <button className="pd-btn pd-btn-primary" onClick={onRestart} aria-label="重新啟動終端機">
            重新啟動
          </button>
        </div>
      )}
    </div>
  );
}
