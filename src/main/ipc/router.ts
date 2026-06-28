// IPC 通道註冊表（channel registry）：store 真實、其餘 feature 預連空樁。
// 後續 feature task 各自實作其 registerXxxHandlers 並由整合波接上。

import { ipcMain } from 'electron';
import type { StateStore } from '../store/StateStore';
import { registerStoreHandlers } from '../store/storeHandlers';
import {
  registerWorkspaceHandlers,
  registerFsHandlers,
  registerGitHandlers,
  registerPtyHandlers,
  registerSearchHandlers,
  registerLspHandlers,
  registerPlaywrightHandlers,
  registerUpdateHandlers,
} from './stubHandlers';

export function registerIpcHandlers(store: StateStore): void {
  // 真實實作
  registerStoreHandlers(ipcMain, store);
  // 空樁（後續 task 取代）
  registerWorkspaceHandlers(ipcMain);
  registerFsHandlers(ipcMain);
  registerGitHandlers(ipcMain);
  registerPtyHandlers(ipcMain);
  registerSearchHandlers(ipcMain);
  registerLspHandlers(ipcMain);
  registerPlaywrightHandlers(ipcMain);
  registerUpdateHandlers(ipcMain);
}
