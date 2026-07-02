// 剪貼簿讀寫（IPC）：終端機的 Ctrl+V/右鍵貼上與複製走此橋。
//
// 為何走 main 端 electron clipboard 而非 renderer navigator.clipboard：
//   REQ-SEC-001 於 main 對 renderer 一律拒絕剪貼簿讀權限（setPermissionCheckHandler→false），
//   故 renderer 的 navigator.clipboard.readText() 會被擋、必回失敗。main process 的 clipboard 模組
//   不受 renderer 權限系統限制；由使用者手勢（Ctrl+V/右鍵）觸發的一次性讀寫＝安全，與 REQ-TERM-008
//   （防 PTY 輸出以 OSC52 escape 挾持剪貼簿）正交——後者防的是「程式輸出自動改剪貼簿」，此處是「使用者
//   主動貼上/複製」，兩者不同面向。

import { clipboard, type IpcMain } from 'electron';

export function registerClipboardHandlers(ipc: IpcMain): void {
  ipc.handle('clipboard:readText', (): { text: string } => ({ text: clipboard.readText() }));
  ipc.handle('clipboard:writeText', (_e, req: { text: string }): { ok: true } => {
    clipboard.writeText(typeof req?.text === 'string' ? req.text : '');
    return { ok: true };
  });
}
