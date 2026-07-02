// xterm 安全初始化選項（REQ-TERM-008 escape 硬化）。
// 純設定模組：只 import type（執行期不載入 xterm），故可於 node 環境單測（secureOptions.test.ts）。
//
// 防禦面：
//  - F-3-A3 終端機回應回灌成輸入：關閉所有「視窗狀態/標題回報」旗標，避免惡意輸出以
//    `\x1b]2;<payload>\x07` 設標題再 `\x1b[21t` 請求回報、把 payload 經 onData 回灌成指令。
//  - F-3-A2 剪貼簿：renderer 不啟用 clipboard addon（核心 xterm 不處理 OSC52）——OSC52 一律由
//    main 端 stripOsc52 單點攔截：寫入解出交系統剪貼簿（2026-07-02 拍板放寬，供 Claude Code 等
//    TUI 選取複製）、查詢（讀取方向）照封不回應、序列本體不進 renderer。

import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import type { TerminalFontSettings } from '../../../shared/types';
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '../../../shared/constants';

/** 預設終端機字型：對齊 VS Code Windows 預設（Consolas 14px，2026-07-02 拍板）。 */
export const DEFAULT_TERMINAL_FONT: TerminalFontSettings = { family: 'Consolas', size: 14 };

/** 首選字型未安裝/缺字時的後備鏈。 */
const TERMINAL_FONT_FALLBACK = '"Cascadia Mono", Consolas, "Liberation Mono", ui-monospace, monospace';

/** 組 CSS font-family：首選字型剝引號（防拼裝壞格式）再加引號（容納含空白字型名），接固定後備鏈。 */
export function buildTerminalFontFamily(family: string): string {
  const f = family.replace(/["']/g, '').trim();
  return f ? `"${f}", ${TERMINAL_FONT_FALLBACK}` : TERMINAL_FONT_FALLBACK;
}

/** 字級守界（與 main 端 sanitize 同一組上下限；防呆非防駭）。 */
export function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TERMINAL_FONT.size;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(size)));
}

/**
 * 全部視窗回報旗標關閉（xterm IWindowOptions）。預設雖多為 off，仍明示釘死＝確定性防禦，
 * 並讓單測可斷言每一旗標皆為 false（防誤啟用回灌通道）。
 */
export const SECURE_WINDOW_OPTIONS = {
  restoreWin: false,
  minimizeWin: false,
  setWinPosition: false,
  setWinSizePixels: false,
  raiseWin: false,
  lowerWin: false,
  refreshWin: false,
  setWinSizeChars: false,
  maximizeWin: false,
  fullscreenWin: false,
  getWinState: false,
  getWinPosition: false,
  getWinSizePixels: false,
  getScreenSizePixels: false,
  getCellSizePixels: false,
  getWinSizeChars: false,
  getScreenSizeChars: false,
  getIconTitle: false,
  getWinTitle: false,
  pushTitle: false,
  popTitle: false,
  setWinLines: false,
} as const;

/** 主題缺省（暗色），TerminalView 會以 CSS var 實值覆蓋。 */
export const DEFAULT_TERMINAL_THEME: ITheme = {
  background: '#0a0a0a',
  foreground: '#ededed',
  cursor: '#ededed',
  selectionBackground: 'rgba(255,255,255,0.20)',
};

/** 產生單一 xterm 實例的安全初始化選項。 */
export function createSecureTerminalOptions(
  theme: ITheme = DEFAULT_TERMINAL_THEME,
  font: TerminalFontSettings = DEFAULT_TERMINAL_FONT,
): ITerminalOptions {
  return {
    // allowProposedApi 只閘「本 app 程式碼可否呼叫 xterm 實驗性 JS API」（Terminal.unicode 等），
    // 不是 PTY 輸出可觸及的防禦邊界——惡意輸出的攻擊面仍由 windowOptions 全關＋不設 linkHandler 守。
    // 開啟是為載入 Unicode11Addon（emoji 算 2 格，與 Windows ConPTY 一致；修狀態列重繪錯位互蓋），
    // 與 VS Code 終端機同款配置（其 terminal.integrated.unicodeVersion 預設 "11"）。
    allowProposedApi: true,
    fontFamily: buildTerminalFontFamily(font.family),
    fontSize: clampTerminalFontSize(font.size),
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    // renderer 不掛 clipboard addon（OSC52 由 main 端單點攔截處理）；視窗回報全關（防回灌注入）。
    // 刻意「不設 linkHandler」：OSC 8 超連結因而保持 inert（不可點擊），杜絕惡意 PTY 以
    // ESC]8;;javascript:/file: 觸發危險導覽。日後若要可點連結，linkHandler 內 SHALL 只放行 http/https。
    windowOptions: { ...SECURE_WINDOW_OPTIONS },
    theme,
  };
}
