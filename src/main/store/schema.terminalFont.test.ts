// terminalFont 持久化 sanitize（與 secureOptions 的 renderer 守界同一組上下限）：
// 竄改/半損毀的 state.json 不得把壞字型設定帶進 normalize 後的狀態。

import { describe, it, expect } from 'vitest';
import { migrate, sanitizeTerminalFont } from './schema';

describe('sanitizeTerminalFont', () => {
  it('合法值原樣通過', () => {
    expect(sanitizeTerminalFont({ family: 'Consolas', size: 14 })).toEqual({ family: 'Consolas', size: 14 });
  });

  it('family 剝引號＋trim；純引號/空白＝整筆拒收', () => {
    expect(sanitizeTerminalFont({ family: ' "Cascadia Code" ', size: 13 })).toEqual({
      family: 'Cascadia Code',
      size: 13,
    });
    expect(sanitizeTerminalFont({ family: '"\'"', size: 13 })).toBeUndefined();
  });

  it('size 超界收斂到上下限、非數值/非有限數整筆拒收', () => {
    expect(sanitizeTerminalFont({ family: 'Consolas', size: 2 })?.size).toBe(8);
    expect(sanitizeTerminalFont({ family: 'Consolas', size: 999 })?.size).toBe(32);
    expect(sanitizeTerminalFont({ family: 'Consolas', size: '14' })).toBeUndefined();
    expect(sanitizeTerminalFont({ family: 'Consolas', size: Number.POSITIVE_INFINITY })).toBeUndefined();
  });

  it('非物件 / 缺欄位 → undefined（＝用預設）', () => {
    expect(sanitizeTerminalFont(null)).toBeUndefined();
    expect(sanitizeTerminalFont('Consolas')).toBeUndefined();
    expect(sanitizeTerminalFont({ family: 'Consolas' })).toBeUndefined();
  });

  it('family 超長截 64 字（防灌爆持久化檔）', () => {
    const long = 'A'.repeat(200);
    expect(sanitizeTerminalFont({ family: long, size: 14 })?.family).toHaveLength(64);
  });
});

describe('migrate 帶 terminalFont', () => {
  it('合法設定經 normalize 保留；壞設定被剔成 undefined', () => {
    const ok = migrate({ schemaVersion: 2, terminalFont: { family: 'Cascadia Mono', size: 16 } });
    expect(ok.terminalFont).toEqual({ family: 'Cascadia Mono', size: 16 });
    const bad = migrate({ schemaVersion: 2, terminalFont: { family: 42, size: 16 } });
    expect(bad.terminalFont).toBeUndefined();
  });
});
