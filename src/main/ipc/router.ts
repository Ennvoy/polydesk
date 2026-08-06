// IPC 通道註冊表（channel registry）：store/workspace/fs/pty/git/search/lsp 真實實作；
// playwright（無接線、僅缺件偵測）/update（X-2）預連空樁。Claude 狀態監控啟動於此。

import { ipcMain } from 'electron';
import type { ConversationRailSession } from '../../shared/types';
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
import { readClaudeTranscript } from '../claude/sessionTranscript';
import { readCodexConversationById, readCodexConversations } from '../monitor/codexConversation';
import { registerUpdateHandlers } from '../update/AutoUpdater';
import { registerExternalUrlHandlers } from '../window/externalUrl';
import { registerWindowControls } from '../window/windowControls';
import {
  EditorPasteFocusState,
  registerEditorPasteFocusHandler,
} from '../window/pasteShortcut';
import { registerPlaywrightHandlers } from './stubHandlers';

/** main 端服務（供 app 生命週期 teardown / 後續波次取用）。 */
export interface MainServices {
  lifecycle: WorkspaceLifecycle;
  workspaces: WorkspaceManager;
  pty: PtyManager;
  fileWatcher: FileWatcher;
  monitor: ClaudeStatusMonitor;
  editorPasteFocus: EditorPasteFocusState;
}

export function registerIpcHandlers(store: StateStore, userDataDir: string): MainServices {
  const lifecycle = new WorkspaceLifecycle();
  const workspaces = new WorkspaceManager(store, lifecycle, userDataDir);
  const editorPasteFocus = new EditorPasteFocusState();

  // 真實實作
  registerStoreHandlers(ipcMain, store);
  registerWorkspaceHandlers(ipcMain, workspaces);
  const fileWatcher = registerFsTreeAndWatch(ipcMain, workspaces, lifecycle); // fs:tree + 監看
  registerFileService(ipcMain, workspaces, (wsId) => fileWatcher.ensureWatch(wsId)); // fs:read / fs:write；read 前先保證 watcher 已建立
  const pty = registerPtyHandlers(ipcMain, workspaces, lifecycle); // pty:*
  registerClipboardHandlers(ipcMain); // clipboard:*（終端機貼上/複製，繞過 renderer 剪貼簿權限封鎖）
  registerGitHandlers(ipcMain, workspaces); // git:*
  registerCommitMessageHandler(ipcMain, workspaces, store); // ai:generateCommitMessage（智慧 commit message）
  registerUsageHandler(ipcMain); // ai:usage（總覽用量）
  registerSearchHandlers(ipcMain, workspaces); // search:*
  registerLspHandlers(ipcMain, workspaces, lifecycle); // lsp:*

  // Claude 狀態監控（讀 Claude Code hooks 狀態檔；emit claude:status；F-1 徽章訂閱）
  const monitor = new ClaudeStatusMonitor(workspaces, pty, undefined, { lifecycle });
  const codexSessionByTerm = new Map<string, string>();
  monitor.start();
  ipcMain.handle('claude:states', () => monitor.snapshot()); // 掛載快照（徽章/計數重掛不丟燈）
  // 終端機級 AI 對話軸：term/process/session 三層都要能可靠綁定，否則 fail-closed 回空節點。
  ipcMain.handle('ai:conversation', async (_e, req: { wsId: string; termId: string; sessionId?: string }) => {
    const cwd = workspaces.get(req.wsId)?.path;
    if (!cwd || pty.workspaceOf(req.termId) !== req.wsId) {
      codexSessionByTerm.delete(req.termId);
      return { tool: null, nodes: [] };
    }
    const tool = await monitor.terminalTool(req.termId);
    if (tool === 'claude') {
      const sessionId = await monitor.claudeSessionForTerminal(req.termId);
      if (!sessionId) return { tool: 'claude', nodes: [] };
      const transcript = await readClaudeTranscript(cwd, undefined, sessionId).catch(() => null);
      return transcript ? { tool: 'claude', ...transcript } : { tool: 'claude', nodes: [] };
    }
    if (tool === 'codex') {
      const terms = pty.list(req.wsId).filter((term) => term.alive);
      const tools = await Promise.all(terms.map((term) => monitor.terminalTool(term.termId)));
      if (tools.filter((value) => value === 'codex').length !== 1) {
        codexSessionByTerm.delete(req.termId);
        return { tool: 'codex', nodes: [] };
      }
      const requestedSessionId = req.sessionId ?? codexSessionByTerm.get(req.termId);
      const bound = requestedSessionId
        ? await readCodexConversationById(cwd, requestedSessionId).catch(() => null)
        : null;
      if (bound) codexSessionByTerm.set(req.termId, bound.sessionId);
      else if (requestedSessionId) codexSessionByTerm.delete(req.termId);
      const candidates = await readCodexConversations(cwd).catch(() => [] as ConversationRailSession[]);
      if (bound && !candidates.some((candidate) => candidate.sessionId === bound.sessionId)) candidates.push(bound);
      return { tool: 'codex', sessionId: bound?.sessionId, nodes: [], candidates };
    }
    codexSessionByTerm.delete(req.termId);
    return { tool: null, nodes: [] };
  });

  registerUpdateHandlers(ipcMain); // update:*（electron-updater）
  registerExternalUrlHandlers(ipcMain); // app:openExternalUrl（HTTP(S) 白名單後交系統瀏覽器）
  registerWindowControls(ipcMain); // window:*（自訂無框標題列 min/max/close）
  registerEditorPasteFocusHandler(ipcMain, editorPasteFocus);
  // 空樁：playwright（無接線、缺件偵測於 F-3 終端機提示）
  registerPlaywrightHandlers(ipcMain);

  return { lifecycle, workspaces, pty, fileWatcher, monitor, editorPasteFocus };
}
