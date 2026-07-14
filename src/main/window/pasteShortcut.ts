import type { IpcMain } from 'electron';

export interface PasteShortcutInput {
  type: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  key: string;
}

/** 僅辨識 Ctrl/Cmd+V keyDown；其餘輸入保留給終端機、一般表單與作業系統。 */
export function isEditorPasteShortcut(input: PasteShortcutInput): boolean {
  return input.type === 'keyDown' && (input.control || input.meta) && !input.alt && input.key.toLowerCase() === 'v';
}

/**
 * main 端同步快取各 WebContents 的 Monaco 文字焦點。
 * before-input-event 必須同步決定是否 preventDefault，不能臨時向 renderer 非同步查詢。
 */
export class EditorPasteFocusState {
  private readonly focused = new Set<number>();

  set(webContentsId: number, focused: boolean): void {
    if (focused) this.focused.add(webContentsId);
    else this.focused.delete(webContentsId);
  }

  has(webContentsId: number): boolean {
    return this.focused.has(webContentsId);
  }

  clear(webContentsId: number): void {
    this.focused.delete(webContentsId);
  }
}

export function registerEditorPasteFocusHandler(ipc: IpcMain, state: EditorPasteFocusState): void {
  ipc.handle('editor:setTextFocus', (event, req: { focused?: unknown }): { ok: true } => {
    state.set(event.sender.id, req?.focused === true);
    return { ok: true };
  });
}
