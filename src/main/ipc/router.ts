// IPC 通道註冊表（channel registry）：store/workspace/fs/pty/git 真實實作；search/lsp/playwright/update 預連空樁。

import { ipcMain } from 'electron';
import type { StateStore } from '../store/StateStore';
import { registerStoreHandlers } from '../store/storeHandlers';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { registerWorkspaceHandlers } from '../workspace/workspaceHandlers';
import { registerFsTreeAndWatch, type FileWatcher } from '../fs/FileWatcher';
import { registerFileService } from '../fs/fileService';
import { registerPtyHandlers, type PtyManager } from '../pty/PtyManager';
import { registerGitHandlers } from '../git/GitService';
import {
  registerSearchHandlers,
  registerLspHandlers,
  registerPlaywrightHandlers,
  registerUpdateHandlers,
} from './stubHandlers';

/** main 端服務（供 app 生命週期 teardown / 後續波次取用）。 */
export interface MainServices {
  lifecycle: WorkspaceLifecycle;
  workspaces: WorkspaceManager;
  pty: PtyManager;
  fileWatcher: FileWatcher;
}

export function registerIpcHandlers(store: StateStore, userDataDir: string): MainServices {
  const lifecycle = new WorkspaceLifecycle();
  const workspaces = new WorkspaceManager(store, lifecycle, userDataDir);

  // 真實實作
  registerStoreHandlers(ipcMain, store);
  registerWorkspaceHandlers(ipcMain, workspaces);
  const fileWatcher = registerFsTreeAndWatch(ipcMain, workspaces, lifecycle); // fs:tree + 監看
  registerFileService(ipcMain, workspaces); // fs:read / fs:write
  const pty = registerPtyHandlers(ipcMain, workspaces, lifecycle); // pty:*
  registerGitHandlers(ipcMain, workspaces); // git:*

  // 空樁（後續 task 取代）
  registerSearchHandlers(ipcMain);
  registerLspHandlers(ipcMain);
  registerPlaywrightHandlers(ipcMain);
  registerUpdateHandlers(ipcMain);

  return { lifecycle, workspaces, pty, fileWatcher };
}
