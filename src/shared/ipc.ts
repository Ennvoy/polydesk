// IPC 契約單一真相（design §3.1）。通道分三類：invoke / stream / event。
// 任何通道增刪先改此檔，再改 main/preload/renderer 三端與 channels.ts。

import type {
  Workspace,
  WorkspaceInput,
  ClaudeStatus,
  GitStatus,
  GitChange,
  GitLogEntry,
  TermState,
  ShellKind,
  FileEncoding,
  Eol,
  SearchHit,
  LspServerInfo,
  LayoutJson,
  ThemeId,
  PersistState,
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
  // git
  'git:status': { req: { wsId: string }; res: GitStatus };
  'git:changes': { req: { wsId: string }; res: GitChange[] };
  'git:diff': { req: { wsId: string; path: string; staged: boolean }; res: { patch: string } };
  'git:stage': { req: { wsId: string; paths: string[]; staged: boolean }; res: { ok: true } };
  'git:commit': { req: { wsId: string; message: string }; res: { ok: true; hash: string } | { error: string } };
  'git:push': { req: { wsId: string }; res: { ok: true } | { error: string } };
  'git:pull': { req: { wsId: string }; res: { ok: true } | { error: string } };
  'git:branch': {
    req: { wsId: string; op: 'list' | 'create' | 'checkout'; name?: string };
    res: { branches: string[]; current: string } | { ok: true };
  };
  'git:log': { req: { wsId: string; limit: number }; res: GitLogEntry[] };
  'git:stash': { req: { wsId: string; op: 'push' | 'pop' | 'list' }; res: unknown };
  'git:init': { req: { wsId: string }; res: { ok: true } };
  // 終端機（控制訊息走 invoke；資料流走 stream）
  'pty:create': { req: { wsId: string; shell: ShellKind }; res: { termId: string } };
  'pty:resize': { req: { termId: string; cols: number; rows: number }; res: { ok: true } };
  'pty:close': { req: { termId: string }; res: { ok: true } };
  'pty:list': { req: { wsId: string }; res: TermState[] };
  // 搜尋（結果走 event 串流）
  'search:run': {
    req: { wsId: string; query: string; opts: { regex?: boolean; caseSensitive?: boolean; replace?: string } };
    res: { searchId: string };
  };
  'search:cancel': { req: { searchId: string }; res: { ok: true } };
  // LSP
  'lsp:probe': { req: { langId: string }; res: LspServerInfo };
  'lsp:install': { req: { langId: string }; res: { ok: true } | { error: string; manual: string } };
  // Playwright 接線
  'playwright:wire': { req: { wsId: string }; res: McpWireResult };
  'playwright:status': { req: void; res: { registered: boolean; conflict?: ConflictInfo } };
  // 持久化 / 主題 / 版面
  'store:getState': { req: void; res: PersistState };
  'store:setTheme': { req: { theme: ThemeId }; res: { ok: true } };
  'store:setLayout': { req: { layout: LayoutJson }; res: { ok: true } };
  'store:export': { req: void; res: { json: string } };
  'store:import': { req: { json: string }; res: { ok: true } | { error: string } };
  // 更新
  'update:check': { req: void; res: { available: boolean; version?: string } };
  'update:install': { req: void; res: { ok: true } };
}

/** stream 通道：PTY 高頻 chunk（建議走 MessagePort 直連，骨架先以事件接線）。 */
export interface StreamChannels {
  'pty:data': { dir: 'main->renderer'; payload: { termId: string; chunk: Uint8Array } };
  'pty:write': { dir: 'renderer->main'; payload: { termId: string; data: string } };
}

/** event 通道：main 主動 `webContents.send` 推播；payload 一律帶 wsId 以路由面板。 */
export interface EventChannels {
  'claude:status': { wsId: string; status: ClaudeStatus };
  'git:statusUpdate': { wsId: string; status: GitStatus };
  'fs:change': { wsId: string; path: string; kind: 'add' | 'change' | 'unlink' };
  'fs:externalEdit': { wsId: string; path: string };
  'pty:exit': { termId: string; exitCode: number };
  'search:result': { searchId: string; hits: SearchHit[]; done: boolean; truncated: boolean };
  'workspace:lost': { wsId: string };
  'update:progress': { percent: number; state: 'checking' | 'downloading' | 'ready' };
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
};
