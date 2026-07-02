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
import '@xterm/xterm/css/xterm.css';
import { ipc } from '../../ipc/client';
import { record } from '../../../shared/perf';
import { createSecureTerminalOptions, DEFAULT_TERMINAL_THEME } from './secureOptions';
import type { ITheme } from '@xterm/xterm';

interface Props {
  termId: string;
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

/** 從 CSS var 讀目前主題色，建構 xterm ITheme（取不到則用暗色缺省）。 */
function readTerminalTheme(el: HTMLElement): ITheme {
  try {
    const cs = getComputedStyle(el);
    const v = (name: string): string => cs.getPropertyValue(name).trim();
    const bg = v('--bg') || DEFAULT_TERMINAL_THEME.background;
    const fg = v('--fg') || DEFAULT_TERMINAL_THEME.foreground;
    return {
      background: bg,
      foreground: fg,
      cursor: fg,
      selectionBackground: 'rgba(127,127,127,0.35)',
    };
  } catch {
    return DEFAULT_TERMINAL_THEME;
  }
}

export function TerminalView({ termId, visible, exitCode, onRestart }: Props): React.JSX.Element {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // 近似按鍵延遲：使用者輸入時記時間戳，下一個回流的 chunk 視為回顯。
  const keyTsRef = useRef<number | null>(null);
  // 上次送往 main 的尺寸；避免版面每次微動都對 ConPTY 連發 resize（重複重繪）。termId 改變時重置。
  const lastSentRef = useRef<{ cols: number; rows: number } | null>(null);
  // 上次實際 fit 時量到的 host 尺寸；供反震盪比對（捲軸回彈在容差內就不再 fit）。
  const lastFitBoxRef = useRef<{ w: number; h: number }>({ w: -1, h: -1 });
  // 由 visible 切換（useLayoutEffect）呼叫的就地 fit；指向 useEffect 內已掛好接線的 safeFit。
  const fitNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    lastSentRef.current = null; // 新 termId：重置「上次送出尺寸」
    lastFitBoxRef.current = { w: -1, h: -1 }; // 與反震盪基準

    const theme = readTerminalTheme(host);
    const term = new Terminal(createSecureTerminalOptions(theme));
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

    // fit + （必要時）回報尺寸給 main。極窄寬（reflow 中間態）→ 不 fit、不 resize；尺寸未變 → 不重送。
    const safeFit = (): void => {
      const h = hostRef.current;
      if (!h || h.offsetWidth === 0 || h.offsetHeight === 0) return;
      try {
        const dims = fit.proposeDimensions();
        // 提議無效或極窄寬（cols 掉到個位數）：略過，待尺寸穩定再校正 → 從源頭斷掉 cols≈1 的窄欄瀑布。
        if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < MIN_FIT_COLS) return;
        fit.fit();
        // 記下這次 fit 的 host 尺寸：供 ResizeObserver 反震盪比對（即使 cols 未變也更新基準）。
        lastFitBoxRef.current = { w: h.offsetWidth, h: h.offsetHeight };
        const last = lastSentRef.current;
        if (last && last.cols === term.cols && last.rows === term.rows) return; // 尺寸未變：不重複 resize
        lastSentRef.current = { cols: term.cols, rows: term.rows };
        void ipc.pty.resize({ termId, cols: term.cols, rows: term.rows });
      } catch {
        /* 尺寸尚未就緒：略過本次 */
      }
    };
    fitNowRef.current = safeFit;

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

    // 輸出：main → term（依 termId 過濾；回流即記一次往返延遲近似值）。
    const offData = ipc.pty.onData(({ termId: t, chunk }) => {
      if (t !== termId) return;
      term.write(chunk);
      if (keyTsRef.current !== null) {
        record('keyLatency', performance.now() - keyTsRef.current);
        keyTsRef.current = null;
      }
    });

    const ro = new ResizeObserver(() => scheduleFit());
    ro.observe(host);
    // 初次 fit（下一幀，確保 DOM 已量得尺寸）。
    const raf = requestAnimationFrame(safeFit);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (fitTimer) clearTimeout(fitTimer);
      themeObserver.disconnect();
      ro.disconnect();
      onDataDisp.dispose();
      offData();
      fitNowRef.current = () => {};
      webglDispose?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [termId]);

  // 由隱藏切回顯示時重新 fit + 聚焦（display:none 時容器尺寸為 0，無法 fit）。
  useLayoutEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    if (!host || host.offsetWidth === 0 || host.offsetHeight === 0) return;
    fitNowRef.current(); // 走同一條 safeFit（含極窄寬守衛 + skip-unchanged + 更新反震盪基準）
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
