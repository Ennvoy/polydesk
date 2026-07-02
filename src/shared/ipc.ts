// IPC 契約單一真相（design §3.1）。通道分三類：invoke / stream / event。
// 任何通道增刪先改此檔，再改 main/preload/renderer 三端與 channels.ts。

import type {
  Workspace,
  WorkspaceInput,
  ClaudeStatus,
  AiTool,
  GitStatus,
  GitChange,
  GitLogEntry,
  GitWorktree,
  TermState,
  ShellKind,
  FileEncoding,
  Eol,
  SearchHit,
  LspServerInfo,
  LayoutJson,
  ThemeId,
  PersistState,
  AiCommitSettings,
  TerminalFontSettings,
  AiUsage,
  McpWireResult,
  ConflictInfo,
} from './types';

/** invoke 通道：renderer 經 preload 呼叫、main `ipcMain.handle` 回應（一次性 Promise）。 */
export interface InvokeChannels {
  // 工作區管理
  'workspace:list': { req: void; res: Workspace[] };
  'workspace:add': { req: WorkspaceInput; res: Workspace | { error: 'duplicate' | 'invalid' } };
  'workspace:remove': { req: { wsId: string; purgeProfile: boolean }; res: { ok: true } };
  'workspace:rename': { req: { wsId: string; name: string }; res: { ok: true } };
  'workspace:reorder': { req: { orderedIds: string[] }; res: { ok: true } };
  'workspace:activate': { req: { wsId: string }; res: { ok: true } };
  'workspace:setShell': { req: { wsId: string; shell: ShellKind }; res: { ok: true } };
  'workspace:pickFolder': { req: void; res: { path: string | null } };
  // 檔案 / 編輯器
  'fs:read': {
    req: { wsId: string; path: string };
    res: { content: string; encoding: FileEncoding; eol: Eol; readonly: boolean };
  };
  'fs:write': {
    req: { wsId: string; path: string; content: string; encoding: FileEncoding; eol: Eol };
    res: { ok: true } | { error: 'permission' | 'conflict' };
  };
  'fs:tree': { req: { wsId: string; dir: string }; res: { entries: { name: string; dir: boolean }[] } };
  // fs 編輯操作（檔案總管右鍵；path 一律經 resolveSafe 限工作區內、防 traversal）
  'fs:create': { req: { wsId: string; path: string; dir: boolean }; res: { ok: true } | { error: string } };
  'fs:rename': { req: { wsId: string; from: string; to: string }; res: { ok: true } | { error: string } };
  'fs:delete': { req: { wsId: string; path: string }; res: { ok: true } | { error: string } };
  'fs:copy': { req: { wsId: string; from: string; to: string }; res: { ok: true } | { error: string } };
  /** 貼入外部檔案（系統剪貼簿）：sources 為外部絕對路徑，複製進 destDir（工作區內、重名自動改名）。 */
  'fs:importFiles': {
    req: { wsId: string; destDir: string; sources: string[] };
    res: { imported: number; names: string[]; errors?: string[] } | { error: string };
  };
  /** 讀 xlsx/xls 等試算表 → 每工作表的儲存格字串矩陣（唯讀預覽，非文字編輯）。 */
  'fs:readSheet': {
    req: { wsId: string; path: string };
    res: { sheets: { name: string; rows: string[][] }[] } | { error: string };
  };
  'fs:reveal': { req: { wsId: string; path: string }; res: { ok: true } | { error: string } };
  // git
  'git:status': { req: { wsId: string }; res: GitStatus };
  'git:changes': { req: { wsId: string }; res: GitChange[] };
  'git:diff': { req: { wsId: string; path: string; staged: boolean }; res: { patch: string } };
  'git:stage': { req: { wsId: string; paths: string[]; staged: boolean }; res: { ok: true } };
  /** 取消變更（discard）：tracked 還原到 HEAD、untracked 刪除（破壞性，前端附確認）。 */
  'git:discard': { req: { wsId: string; paths: string[] }; res: { ok: true } };
  /** 將路徑加入工作區根 .gitignore。 */
  'git:ignore': { req: { wsId: string; paths: string[] }; res: { ok: true } };
  'git:commit': { req: { wsId: string; message: string }; res: { ok: true; hash: string } | { error: string } };
  'git:push': { req: { wsId: string }; res: { ok: true } | { error: string } };
  'git:pull': { req: { wsId: string }; res: { ok: true } | { error: string } };
  'git:branch': {
    req: { wsId: string; op: 'list' | 'create' | 'checkout'; name?: string; startPoint?: string };
    res: { branches: string[]; current: string; remotes?: string[] } | { ok: true };
  };
  'git:log': { req: { wsId: string; limit: number }; res: GitLogEntry[] };
  /** commit diff（git show <ref>；給 path 則限定單檔）；PE-1 右鍵/展開檔案用。 */
  'git:show': { req: { wsId: string; ref: string; path?: string }; res: { patch: string } };
  /** 某 commit 變更的檔案清單 + 狀態（點 commit 展開檔案用，PE-1）。 */
  'git:commitFiles': { req: { wsId: string; ref: string }; res: { files: { path: string; status: string }[] } };
  'git:stash': { req: { wsId: string; op: 'push' | 'pop' | 'list'; includeUntracked?: boolean }; res: unknown };
  'git:init': { req: { wsId: string }; res: { ok: true } };
  // Git Worktree（REQ-WT，第二迭代）
  'git:worktreeList': { req: { wsId: string }; res: { list: GitWorktree[] } | { error: string } };
  'git:worktreeAdd': {
    req: {
      wsId: string;
      branch: { kind: 'existing' | 'new' | 'remote'; name: string; base?: string };
      /** 使用者選定/預設路徑；main 端仍過 validateWorktreeTarget 驗證。 */
      path: string;
    };
    res: { wsId: string } | { error: string; code?: 'branch-taken' | 'path-exists' | 'net' | 'invalid-path' };
  };
  'git:worktreeRemove': {
    req: { wsId: string; deleteFolder: boolean; force: boolean };
    res: { ok: true } | { error: string; code?: 'dirty' | 'busy' };
  };
  'git:worktreePrune': { req: { wsId: string }; res: { pruned: number } | { error: string } };
  /** REQ-WT-002：此 repo 是否支援建 worktree（bare/submodule 不支援，供對話框事前提示）。 */
  'git:worktreeSupported': {
    req: { wsId: string };
    res: { supported: boolean; reason?: 'bare' | 'submodule' | 'not-repo' } | { error: string };
  };
  /** 納管一個「外部建立、尚未加入 Polydesk」的 worktree 路徑（F-13 跳轉用；先 lineage 驗證隸屬本 repo）。 */
  'git:worktreeAdopt': {
    req: { wsId: string; path: string };
    res: { wsId: string } | { error: string; code?: 'not-lineage' | 'not-found' };
  };
  // AI 智慧 commit message（取 staged diff → 選定引擎產生；只回填訊息框、不自動 commit）
  'ai:generateCommitMessage': { req: { wsId: string }; res: { message: string } | { error: string } };
  // 總覽面板：claude/codex 的 5h/週用量額度
  'ai:usage': { req: void; res: AiUsage };
  /** 目前所有（工作區×工具）AI 狀態快照：徽章/計數掛載先拉現況再訂閱 claude:status（重掛不丟燈）。 */
  'claude:states': { req: void; res: { wsId: string; tool: AiTool; status: ClaudeStatus }[] };
  // 終端機（控制訊息走 invoke；資料流走 stream）
  'pty:create': { req: { wsId: string; shell: ShellKind }; res: { termId: string } };
  'pty:resize': { req: { termId: string; cols: number; rows: number }; res: { ok: true } };
  'pty:close': { req: { termId: string }; res: { ok: true } };
  'pty:list': { req: { wsId: string }; res: TermState[] };
  // 剪貼簿（終端機貼上/複製）：讀取走 main 端 electron clipboard——renderer 的 navigator.clipboard
  // 讀權限被 REQ-SEC-001 封鎖（setPermissionCheckHandler→false）。屬使用者手勢觸發的一次性讀取，
  // 與 REQ-TERM-008（防 PTY 輸出經 OSC52 挾持剪貼簿）正交、不掛 clipboard addon。
  'clipboard:readText': { req: void; res: { text: string } };
  'clipboard:writeText': { req: { text: string }; res: { ok: true } };
  // 搜尋（結果走 event 串流）
  'search:run': {
    req: { wsId: string; query: string; opts: { regex?: boolean; caseSensitive?: boolean; replace?: string } };
    res: { searchId: string };
  };
  'search:cancel': { req: { searchId: string }; res: { ok: true } };
  // LSP（自製 bridge：main spawn 語言伺服器 stdio + vscode-jsonrpc，橋到 renderer monaco）
  'lsp:probe': { req: { langId: string }; res: LspServerInfo };
  'lsp:install': { req: { langId: string }; res: { ok: true } | { error: string; manual: string } };
  /** renderer monaco provider 經此向語言伺服器發 request（completion/hover/definition…）。 */
  'lsp:request': { req: { wsId: string; langId: string; method: string; params: unknown }; res: { result?: unknown; error?: string } };
  /** 同步文件生命週期到語言伺服器（didOpen/didChange/didClose）。 */
  'lsp:sync': {
    req: { wsId: string; langId: string; uri: string; version: number; kind: 'open' | 'change' | 'close'; text?: string };
    res: { ok: true };
  };
  // Playwright 接線
  'playwright:wire': { req: { wsId: string }; res: McpWireResult };
  'playwright:status': { req: void; res: { registered: boolean; conflict?: ConflictInfo } };
  // 持久化 / 主題 / 版面
  'store:getState': { req: void; res: PersistState };
  'store:setTheme': { req: { theme: ThemeId }; res: { ok: true } };
  'store:setLayout': { req: { layout: LayoutJson }; res: { ok: true } };
  'store:setRailWidth': { req: { width: number }; res: { ok: true } };
  'store:setAiCommit': { req: { cfg: AiCommitSettings }; res: { ok: true } };
  'store:setTerminalFont': { req: { cfg: TerminalFontSettings }; res: { ok: true } };
  'store:export': { req: void; res: { json: string } };
  'store:import': { req: { json: string }; res: { ok: true } | { error: string } };
  // 更新
  'update:check': { req: void; res: { available: boolean; version?: string } };
  'update:install': { req: void; res: { ok: true } };
  // 視窗控制（frame:false 自訂無框標題列；renderer 自畫 min/max/close）
  'window:minimize': { req: void; res: { ok: true } };
  'window:maximizeToggle': { req: void; res: { maximized: boolean } };
  'window:close': { req: void; res: { ok: true } };
  'window:isMaximized': { req: void; res: { maximized: boolean } };
}

/** stream 通道：PTY 高頻 chunk（建議走 MessagePort 直連，骨架先以事件接線）。 */
export interface StreamChannels {
  'pty:data': { dir: 'main->renderer'; payload: { termId: string; chunk: Uint8Array } };
  'pty:write': { dir: 'renderer->main'; payload: { termId: string; data: string } };
}

/** event 通道：main 主動 `webContents.send` 推播；payload 一律帶 wsId 以路由面板。 */
export interface EventChannels {
  'claude:status': { wsId: string; tool: AiTool; status: ClaudeStatus };
  'fs:change': { wsId: string; path: string; kind: 'add' | 'change' | 'unlink' };
  'pty:exit': { termId: string; exitCode: number };
  'search:result': { searchId: string; hits: SearchHit[]; done: boolean; truncated: boolean };
  'lsp:diagnostics': { wsId: string; uri: string; diagnostics: unknown[] };
  'update:progress': { percent: number; state: 'checking' | 'downloading' | 'ready' };
  /** 視窗最大化狀態變動（自訂標題列同步 max/restore 圖示；OS 快捷鍵/雙擊也會觸發）。 */
  'window:maximizedChange': { maximized: boolean };
}

export type InvokeChannel = keyof InvokeChannels;
export type EventChannel = keyof EventChannels;

export type InvokeReq<C extends InvokeChannel> = InvokeChannels[C]['req'];
export type InvokeRes<C extends InvokeChannel> = InvokeChannels[C]['res'];
export type EventPayload<C extends EventChannel> = EventChannels[C];

type Unsubscribe = () => void;
type NamespaceOf<C extends string> = C extends `${infer NS}:${string}` ? NS : never;
type InvokeNamespace = NamespaceOf<InvokeChannel>;
type EventNamespace = NamespaceOf<EventChannel>;

type InvokeApi = {
  [NS in InvokeNamespace]: {
    [C in InvokeChannel as C extends `${NS}:${infer M}` ? M : never]: (
      req: InvokeReq<C>,
    ) => Promise<InvokeRes<C>>;
  };
};
type EventApi = {
  [NS in EventNamespace]: {
    [C in EventChannel as C extends `${NS}:${infer M}` ? M : never]: (
      cb: (payload: EventPayload<C>) => void,
    ) => Unsubscribe;
  };
};

/**
 * preload 暴露於 `window.polydesk` 的最小 namespaced API（一個 IPC 一個方法）。
 * 例：`window.polydesk.store.getState()`、`window.polydesk.events.claude.status(cb)`。
 */
export type PolydeskApi = Omit<InvokeApi, 'pty'> & {
  pty: InvokeApi['pty'] & {
    write: (termId: string, data: string) => void;
    onData: (cb: (payload: { termId: string; chunk: Uint8Array }) => void) => Unsubscribe;
  };
  events: EventApi;
  /** 檔案工具（非 IPC，preload 直接橋接 Electron webUtils）：取得 File 的真實磁碟路徑，供貼上/拖放匯入。 */
  fileUtils: {
    pathForFile: (file: File) => string;
  };
};
