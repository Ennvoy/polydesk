import { describe, expect, it } from 'vitest';
import { EditorPasteFocusState, isEditorPasteShortcut, type PasteShortcutInput } from './pasteShortcut';

function input(partial: Partial<PasteShortcutInput>): PasteShortcutInput {
  return { type: 'keyDown', control: false, meta: false, alt: false, key: '', ...partial };
}

describe('isEditorPasteShortcut', () => {
  it('接受 Windows Ctrl+V 與 macOS Cmd+V', () => {
    expect(isEditorPasteShortcut(input({ control: true, key: 'v' }))).toBe(true);
    expect(isEditorPasteShortcut(input({ meta: true, key: 'V' }))).toBe(true);
  });

  it('拒絕 keyUp、Alt 組合與其他按鍵', () => {
    expect(isEditorPasteShortcut(input({ type: 'keyUp', control: true, key: 'v' }))).toBe(false);
    expect(isEditorPasteShortcut(input({ control: true, alt: true, key: 'v' }))).toBe(false);
    expect(isEditorPasteShortcut(input({ control: true, key: 'c' }))).toBe(false);
  });
});

describe('EditorPasteFocusState', () => {
  it('依 WebContents 隔離焦點，失焦或清除後不再攔截', () => {
    const state = new EditorPasteFocusState();
    state.set(7, true);

    expect(state.has(7)).toBe(true);
    expect(state.has(8)).toBe(false);

    state.set(7, false);
    expect(state.has(7)).toBe(false);

    state.set(7, true);
    state.clear(7);
    expect(state.has(7)).toBe(false);
  });
});
