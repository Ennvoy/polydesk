// F-3-A3 設定不變量測試（node 環境，無 DOM）：確認 xterm 安全選項把所有「視窗/標題回報」
// 旗標釘為 false、且未啟用任何剪貼簿寫入通道。runtime xterm 行為另由 Playwright E2E 覆蓋。

import { describe, it, expect } from 'vitest';
import {
  SECURE_WINDOW_OPTIONS,
  createSecureTerminalOptions,
  buildTerminalFontFamily,
  clampTerminalFontSize,
  DEFAULT_TERMINAL_FONT,
} from './secureOptions';

describe('xterm 安全選項（F-3-A3 escape 硬化）', () => {
  it('SECURE_WINDOW_OPTIONS 所有旗標皆為 false（含標題/視窗狀態回報）', () => {
    const values = Object.values(SECURE_WINDOW_OPTIONS);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === false)).toBe(true);
    // 點名最危險的回報旗標（會把攻擊者設定的標題回灌成輸入）
    expect(SECURE_WINDOW_OPTIONS.getWinTitle).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.getIconTitle).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.getWinState).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.getWinPosition).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.getWinSizePixels).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.getCellSizePixels).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.getWinSizeChars).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.pushTitle).toBe(false);
    expect(SECURE_WINDOW_OPTIONS.popTitle).toBe(false);
  });

  it('createSecureTerminalOptions 帶入全關的 windowOptions、且不含任何 clipboard 啟用旗標', () => {
    const opts = createSecureTerminalOptions();
    expect(opts.windowOptions).toBeDefined();
    expect(Object.values(opts.windowOptions ?? {}).every((v) => v === false)).toBe(true);
    // 不應出現任何 clipboard/OSC52 寫入相關設定（核心 xterm 不處理、亦不掛 addon）
    expect(JSON.stringify(opts).toLowerCase()).not.toContain('clipboard');
  });

  it('X-4：allowProposedApi 為 true（僅供載入 Unicode11Addon；非 PTY 防禦邊界），且不設 linkHandler（OSC 8 連結保持 inert）', () => {
    const opts = createSecureTerminalOptions();
    // allowProposedApi 只閘「本 app 程式碼可否呼叫 xterm 實驗性 JS API」（Terminal.unicode 等），
    // 惡意 PTY 輸出觸不到；防回灌/防導覽仍由 windowOptions 全關＋不設 linkHandler 守（上兩測試）。
    expect(opts.allowProposedApi).toBe(true);
    // 不啟用任何 OSC 8 連結處理器 → 惡意 PTY 無法以 ESC]8;;javascript:/file: 觸發危險導覽
    expect('linkHandler' in opts).toBe(false);
  });
});

describe('終端機字型選項', () => {
  it('預設字型為 Consolas 14（對齊 VS Code Windows 預設）', () => {
    expect(DEFAULT_TERMINAL_FONT).toEqual({ family: 'Consolas', size: 14 });
    const opts = createSecureTerminalOptions();
    expect(opts.fontFamily).toMatch(/^"Consolas", /);
    expect(opts.fontSize).toBe(14);
  });

  it('buildTerminalFontFamily 剝引號防拼裝壞格式、空值退後備鏈', () => {
    expect(buildTerminalFontFamily('Cascadia Code')).toMatch(/^"Cascadia Code", /);
    expect(buildTerminalFontFamily('"JetBrains Mono"')).toMatch(/^"JetBrains Mono", /);
    expect(buildTerminalFontFamily('   ')).not.toContain('""');
  });

  it('clampTerminalFontSize 超界收斂、非有限數退預設', () => {
    expect(clampTerminalFontSize(2)).toBe(8);
    expect(clampTerminalFontSize(99)).toBe(32);
    expect(clampTerminalFontSize(13.6)).toBe(14);
    expect(clampTerminalFontSize(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT.size);
  });
});
