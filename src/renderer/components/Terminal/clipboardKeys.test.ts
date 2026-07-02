// 終端機剪貼簿快捷鍵判定單測（node 環境、純函式，無 xterm/DOM）。
// 守兩件事：① Windows 風 Ctrl+V 等被判為貼上（xterm 預設會送 ^V 不貼上，故需自己接管）；
// ② 純 Ctrl+C 不被攔＝保留 SIGINT（回歸守衛，別誤把中斷鍵當複製）。

import { describe, it, expect } from 'vitest';
import { classifyClipboardKey, type ClipboardKeyLike } from './clipboardKeys';

function key(partial: Partial<ClipboardKeyLike>): ClipboardKeyLike {
  return { type: 'keydown', code: '', ctrlKey: false, metaKey: false, shiftKey: false, ...partial };
}

describe('classifyClipboardKey（終端機貼上/複製快捷鍵）', () => {
  it('Ctrl+V → paste', () => {
    expect(classifyClipboardKey(key({ code: 'KeyV', ctrlKey: true }))).toBe('paste');
  });

  it('Ctrl+Shift+V → paste（傳統終端貼上鍵也放行）', () => {
    expect(classifyClipboardKey(key({ code: 'KeyV', ctrlKey: true, shiftKey: true }))).toBe('paste');
  });

  it('Cmd+V（mac / metaKey）→ paste', () => {
    expect(classifyClipboardKey(key({ code: 'KeyV', metaKey: true }))).toBe('paste');
  });

  it('Shift+Insert → paste', () => {
    expect(classifyClipboardKey(key({ code: 'Insert', shiftKey: true }))).toBe('paste');
  });

  it('Ctrl+Shift+C → copy', () => {
    expect(classifyClipboardKey(key({ code: 'KeyC', ctrlKey: true, shiftKey: true }))).toBe('copy');
  });

  it('純 Ctrl+C → null（保留給 SIGINT，不可攔）', () => {
    expect(classifyClipboardKey(key({ code: 'KeyC', ctrlKey: true }))).toBeNull();
  });

  it('無修飾鍵的 v/c/Insert → null（正常輸入，不攔）', () => {
    expect(classifyClipboardKey(key({ code: 'KeyV' }))).toBeNull();
    expect(classifyClipboardKey(key({ code: 'KeyC' }))).toBeNull();
    expect(classifyClipboardKey(key({ code: 'Insert' }))).toBeNull();
  });

  it('非 keydown（keyup/keypress）一律 null（避免重複觸發）', () => {
    expect(classifyClipboardKey(key({ type: 'keyup', code: 'KeyV', ctrlKey: true }))).toBeNull();
    expect(classifyClipboardKey(key({ type: 'keypress', code: 'KeyV', ctrlKey: true }))).toBeNull();
  });
});
