// IPC 通道註冊表（channel registry）：store + workspace 真實實作；其餘 feature 預連空樁。
// 後續 feature task 各自實作其 registerXxxHandlers 並由整合波接上（取代 stub）。

import { ipcMain } from 'electron';
import type { StateStore } from '../store/StateStore';
import { registerStoreHandlers } from '../store/storeHandlers';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { registerWorkspaceHandlers } from '../workspace/workspaceHandlers';
import {
  registerFsHandlers,
  registerGitHandlers,
  registerPtyHandlers,
  registerSearchHandlers,
  registerLspHandlers,
  registerPlaywrightHandlers,
  registerUpdateHandlers,
} from './stubHandlers';

/** main 端服務（供 app 生命週期 teardown / 後續波次取用）。 */
export interface MainServices {
  lifecycle: WorkspaceLifecycle;
  workspaces: WorkspaceManager;
}

export function registerIpcHandlers(store: StateStore, userDataDir: string): MainServices {
  const lifecycle = new WorkspaceLifecycle();
  const workspaces = new WorkspaceManager(store, lifecycle, userDataDir);

  // 真實實作
  registerStoreHandlers(ipcMain, store);
  registerWorkspaceHandlers(ipcMain, workspaces);

  // 空樁（後續 task 取代）
  registerFsHandlers(ipcMain);
  registerGitHandlers(ipcMain);
  registerPtyHandlers(ipcMain);
  registerSearchHandlers(ipcMain);
  registerLspHandlers(ipcMain);
  registerPlaywrightHandlers(ipcMain);
  registerUpdateHandlers(ipcMain);

  return { lifecycle, workspaces };
}
