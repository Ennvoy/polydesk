// 尚未實作的 feature namespace 空樁：把 IPC 介面表面釘齊，讓 renderer 可呼叫而不崩潰；
// 真正實作由後續 feature task 取代（呼叫時 throw「尚未實作」→ renderer invoke reject，非假成功）。
//
// 已被真實實作取代（不再 stub）：workspace（P-3）、fs（F-2+F-4）、pty（F-3）、git（F-7）、
// search（F-6）、lsp（F-5）。剩餘 playwright（無接線、僅缺件偵測，F-3 終端機內提示）、update（X-2）。

import type { IpcMain } from 'electron';
import { INVOKE_CHANNELS } from '../../shared/channels';

function notImplemented(channel: string) {
  return (): never => {
    throw new Error(`[Polydesk] IPC "${channel}" 尚未實作（由後續 task 提供）`);
  };
}

/** 把某 namespace 下所有 invoke 通道註冊為「尚未實作」樁。 */
function stubNamespace(ipc: IpcMain, ns: string): void {
  for (const ch of INVOKE_CHANNELS) {
    if (ch.startsWith(`${ns}:`)) ipc.handle(ch, notImplemented(ch));
  }
}

export const registerPlaywrightHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'playwright');
export const registerUpdateHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'update');
