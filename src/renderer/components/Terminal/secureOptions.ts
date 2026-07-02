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

export const TERMINAL_FONT_FAMILY =
  '"Geist Mono", "Cascadia Code", "SF Mono", Consolas, "Liberation Mono", ui-monospace, monospace';

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
export function createSecureTerminalOptions(theme: ITheme = DEFAULT_TERMINAL_THEME): ITerminalOptions {
  return {
    // 最小權限（REQ-TERM-008）：不啟用 xterm proposed/不穩定 API（現有 addon 不需要）。
    allowProposedApi: false,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
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
