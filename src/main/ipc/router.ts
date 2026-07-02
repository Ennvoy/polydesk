// IPC 通道註冊表（channel registry）：store/workspace/fs/pty/git/search/lsp 真實實作；
// playwright（無接線、僅缺件偵測）/update（X-2）預連空樁。Claude 狀態監控啟動於此。

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
import { registerCommitMessageHandler } from '../ai/CommitMessageService';
import { registerUsageHandler } from '../ai/usageService';
import { registerSearchHandlers } from '../search/SearchService';
import { registerLspHandlers } from '../lsp/LspManager';
import { registerClipboardHandlers } from '../clipboard/clipboardHandlers';
import { ClaudeStatusMonitor } from '../monitor/ClaudeStatusMonitor';
import { registerUpdateHandlers } from '../update/AutoUpdater';
import { registerWindowControls } from '../window/windowControls';
import { registerPlaywrightHandlers } from './stubHandlers';

/** main 端服務（供 app 生命週期 teardown / 後續波次取用）。 */
export interface MainServices {
  lifecycle: WorkspaceLifecycle;
  workspaces: WorkspaceManager;
  pty: PtyManager;
  fileWatcher: FileWatcher;
  monitor: ClaudeStatusMonitor;
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
  registerClipboardHandlers(ipcMain); // clipboard:*（終端機貼上/複製，繞過 renderer 剪貼簿權限封鎖）
  registerGitHandlers(ipcMain, workspaces); // git:*
  registerCommitMessageHandler(ipcMain, workspaces, store); // ai:generateCommitMessage（智慧 commit message）
  registerUsageHandler(ipcMain); // ai:usage（總覽用量）
  registerSearchHandlers(ipcMain, workspaces); // search:*
  registerLspHandlers(ipcMain, workspaces, lifecycle); // lsp:*

  // Claude 狀態監控（讀 Claude Code hooks 狀態檔；emit claude:status；F-1 徽章訂閱）
  const monitor = new ClaudeStatusMonitor(workspaces, pty, undefined, { lifecycle });
  monitor.start();

  registerUpdateHandlers(ipcMain); // update:*（electron-updater）
  registerWindowControls(ipcMain); // window:*（自訂無框標題列 min/max/close）
  // 空樁：playwright（無接線、缺件偵測於 F-3 終端機提示）
  registerPlaywrightHandlers(ipcMain);

  return { lifecycle, workspaces, pty, fileWatcher, monitor };
}
