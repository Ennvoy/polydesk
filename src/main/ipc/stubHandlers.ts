// 各 feature 的 registerXxxHandlers 空樁：把 IPC 介面表面一次釘齊，
// 讓 renderer 可呼叫而不崩潰；真正實作由後續 feature task 取代。
// 呼叫時 throw「尚未實作」→ renderer invoke reject，狀態清楚（非假裝成功）。

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

export const registerWorkspaceHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'workspace');
export const registerFsHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'fs');
export const registerGitHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'git');
export const registerPtyHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'pty');
export const registerSearchHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'search');
export const registerLspHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'lsp');
export const registerPlaywrightHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'playwright');
export const registerUpdateHandlers = (ipc: IpcMain): void => stubNamespace(ipc, 'update');
