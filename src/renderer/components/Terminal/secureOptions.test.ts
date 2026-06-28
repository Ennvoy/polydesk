// F-3-A3 設定不變量測試（node 環境，無 DOM）：確認 xterm 安全選項把所有「視窗/標題回報」
// 旗標釘為 false、且未啟用任何剪貼簿寫入通道。runtime xterm 行為另由 Playwright E2E 覆蓋。

import { describe, it, expect } from 'vitest';
import { SECURE_WINDOW_OPTIONS, createSecureTerminalOptions } from './secureOptions';

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
});
