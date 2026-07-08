// 通用 LSP 橋接（F-5：REQ-EDIT-003/004/005、REQ-NFR-001、REQ-E2E-002 後半）。
// 自製 thin bridge（decision LSP-BRIDGE）：main spawn 語言伺服器(stdio) + vscode-jsonrpc ↔ renderer
// monaco provider。不用 monaco-languageclient（會接管 monaco 與 F-4 plain monaco 衝突白屏）。
//
// 安全/穩定硬化（紅軍 F-5-A1~A5）：
//  A1 受信任閘門：未信任工作區一律「不 spawn」降級（開檔讀 ≠ 同意執行任意 code，學 VSCode Workspace
//     Trust）；spawn env 帶 GOTOOLCHAIN=local 降低 go toolchain 自動下載執行的副作用。
//  A2 cwd 執行檔劫持：command 一律用 serverProbe 解析的「PATH 內、非工作區」絕對路徑，shell:false。
//  A3 越權轉發：lsp:request 方法白名單（僅唯讀 language feature，拒 workspace/executeCommand）；wsId
//     須對應已 activate＋已信任工作區；uri 經正規化 + path containment 落在工作區根內才轉發。
//  A4 巨檔 / framing：>maxFileBytes 不啟 LSP（走 F-4 降級）；reader 經 ContentLengthLimiter 設上限；
//     diagnostics 推送前截斷數量。
//  A5 卡死/teardown：每 request 設逾時（逾時回 error，不靜默永久 pending）；監聽 spawn error/exit/close
//     即清理降級；工作區 teardown 對 LS 做 tree-kill（含子程序）；以 (wsId,serverId) 復用避免重複 spawn。

import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSpawnEnv } from '../security/spawnEnv';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import type { IpcMain } from 'electron';
import type { LspServerInfo } from '../../shared/types';
import type { InvokeReq, InvokeRes, EventChannels } from '../../shared/ipc';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { emit } from '../ipc/broadcast';
import { byLangId } from './languageRegistry';
import { probeServer, resolveOnPath } from './serverProbe';

// ── JSON-RPC（LSP）Content-Length framing 上限守門（紅軍 F-5-A4）──
// thin bridge 以 vscode-jsonrpc 的 StreamMessageReader 解析 stdout。若無上限，畸形/被劫持的語言伺服器
// 回 `Content-Length: 9999999999` 會讓 reader 嘗試緩衝該大小 → main process OOM/卡死（Electron 單點，
// REQ-NFR-002）。本 Transform 串在 child.stdout 與 reader 之間：只看 header 取 Content-Length，超上限即
// onViolation（驅動關連線/kill child）並 destroy——「絕不」配置宣稱大小的緩衝。

/** 預設單一訊息上限（32MB）：正常 LSP 訊息遠小於此；超過視為畸形/攻擊。 */
export const DEFAULT_MAX_FRAME_BYTES = 32 * 1024 * 1024;
/** header 區塊上限（防無 `\r\n\r\n` 終止的無界 header DoS）。 */
const MAX_HEADER_BYTES = 8 * 1024;
const HEADER_SEP = '\r\n\r\n';

/** 從 header 區塊字串取 Content-Length；缺/非數字回 null（超大數字仍回該數值供上限比較）。 */
export function parseContentLength(header: string): number | null {
  const m = /content-length:\s*(\d+)/i.exec(header);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Content-Length 上限守門 Transform：pass-through 正常資料；偵測到超限或畸形 header → 觸發
 * onViolation 並 destroy（不再轉送、不配置 body 緩衝）。
 */
export class ContentLengthLimiter extends Transform {
  private mode: 'header' | 'body' = 'header';
  private headerBuf: Buffer = Buffer.alloc(0);
  private remainingBody = 0;
  private violated = false;

  constructor(
    private readonly maxBytes: number,
    /** 違規回呼：帶宣稱長度（畸形 header 時為 -1）。應在此關連線 / kill child。 */
    private readonly onViolation: (declaredLength: number) => void,
  ) {
    super();
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.violated) {
      cb();
      return;
    }
    try {
      let data: Buffer = chunk;
      while (data.length > 0) {
        if (this.mode === 'body') {
          const take = Math.min(this.remainingBody, data.length);
          this.push(data.subarray(0, take)); // 串流 body bytes，不整包緩衝
          this.remainingBody -= take;
          data = data.subarray(take);
          if (this.remainingBody === 0) this.mode = 'header';
          continue;
        }
        const combined = this.headerBuf.length ? Buffer.concat([this.headerBuf, data]) : data;
        const sep = combined.indexOf(HEADER_SEP);
        if (sep === -1) {
          if (combined.length > MAX_HEADER_BYTES) {
            cb();
            this.violate(-1);
            return;
          }
          this.headerBuf = combined;
          break; // 等更多資料
        }
        const headerStr = combined.subarray(0, sep).toString('ascii');
        const len = parseContentLength(headerStr);
        if (len === null || len < 0 || len > this.maxBytes) {
          cb();
          this.violate(len ?? -1);
          return;
        }
        this.push(combined.subarray(0, sep + HEADER_SEP.length)); // 轉送 header + 分隔
        this.remainingBody = len;
        this.mode = 'body';
        this.headerBuf = Buffer.alloc(0);
        data = combined.subarray(sep + HEADER_SEP.length);
      }
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }

  private violate(declaredLength: number): void {
    if (this.violated) return;
    this.violated = true;
    this.headerBuf = Buffer.alloc(0);
    try {
      this.onViolation(declaredLength);
    } finally {
      this.destroy(); // 結束串流（無 error，避免未處理 'error' 事件）
    }
  }
}

// ── 常數 ──
const REQUEST_TIMEOUT_MS = 5_000;
const INIT_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 180_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DIAGNOSTICS = 1_000;

/** 唯讀 language feature 方法白名單（A3）：副作用方法（workspace/executeCommand…）一律拒。 */
const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'textDocument/completion',
  'completionItem/resolve',
  'textDocument/hover',
  'textDocument/definition',
  'textDocument/typeDefinition',
  'textDocument/declaration',
  'textDocument/implementation',
  'textDocument/references',
  'textDocument/documentSymbol',
  'textDocument/signatureHelp',
]);

// ── 可注入抽象（測試傳真實/受控 fake；不 mock 被測邏輯）──

/** child_process 子集（LspManager 實際用到的面）。 */
export interface LspChild {
  readonly pid?: number;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: 'error' | 'exit', listener: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type LspSpawnFn = (
  command: string,
  args: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => LspChild;

/** vscode-jsonrpc MessageConnection 子集。 */
export interface LspConnection {
  listen(): void;
  sendRequest(method: string, params: unknown): Promise<unknown>;
  sendNotification(method: string, params: unknown): void;
  onNotification(method: string, handler: (params: unknown) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (err: unknown) => void): void;
  dispose(): void;
}

export type LspConnectFactory = (child: LspChild, onFrameViolation: () => void) => LspConnection;

/** 工作區查詢子集（WorkspaceManager 結構相容；測試傳受控 fake 控制 trusted/hydrated）。 */
export interface LspWorkspaceView {
  get(wsId: string): { path: string; trusted: boolean; hydrated: boolean } | undefined;
  list(): { id: string; path: string }[];
}

export interface LspDeps {
  spawn?: LspSpawnFn;
  connect?: LspConnectFactory;
  probe?: (langId: string, excludeDirs: string[]) => LspServerInfo;
  emitDiagnostics?: (payload: EventChannels['lsp:diagnostics']) => void;
  treeKill?: (pid: number) => void | Promise<void>;
  runInstall?: (file: string, args: string[]) => Promise<void>;
  requestTimeoutMs?: number;
  initTimeoutMs?: number;
  maxFileBytes?: number;
  maxDiagnostics?: number;
}

// ── 預設實作 ──

const defaultSpawn: LspSpawnFn = (command, args, opts) =>
  nodeSpawn(command, args as string[], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false, // 一律不經 shell（A2）：command 為絕對路徑、裸名永不入 spawn
    windowsHide: true,
  }) as unknown as LspChild;

const defaultConnect: LspConnectFactory = (child, onFrameViolation) => {
  const limiter = new ContentLengthLimiter(DEFAULT_MAX_FRAME_BYTES, () => onFrameViolation());
  limiter.on('error', () => {
    /* 違規/串流錯誤由 onFrameViolation 收尾，避免未處理 error 事件 */
  });
  child.stdout.pipe(limiter);
  const reader = new StreamMessageReader(limiter);
  const writer = new StreamMessageWriter(child.stdin);
  const conn = createMessageConnection(reader, writer);
  return {
    listen: () => conn.listen(),
    sendRequest: (method, params) => conn.sendRequest(method, params),
    sendNotification: (method, params) => {
      void conn.sendNotification(method, params);
    },
    onNotification: (method, handler) => {
      conn.onNotification(method, (p: unknown) => handler(p));
    },
    onClose: (handler) => {
      conn.onClose(handler);
    },
    onError: (handler) => {
      conn.onError((e) => handler(e));
    },
    dispose: () => conn.dispose(),
  };
};

function defaultTreeKill(pid: number): void | Promise<void> {
  if (process.platform === 'win32') {
    // 回傳 promise 讓 app 關閉路徑 await 到 taskkill 真的跑完——否則 app.exit 先到、LS 變孤兒。
    return new Promise<void>((resolve) => {
      nodeExecFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()); // best-effort：程序可能已自行結束
    });
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* 已結束 */
  }
}

function defaultRunInstall(file: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    nodeExecFile(
      file,
      args,
      // REQ-SEC-002：安裝器（npm/pip/go）會跑 postinstall 任意腳本 → 給白名單最小 env，不漏機密/注入向量。
      { cwd: homedir(), env: buildSpawnEnv(), windowsHide: true, timeout: INSTALL_TIMEOUT_MS, shell: false },
      (err) => (err ? rej(err) : res()),
    );
  });
}

// ── 純小工具 ──

/** uri → 本機檔案系統路徑；非 file:// / 解析失敗回 null。 */
function uriToFsPath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** fs 路徑 → file:// uri 字串。 */
function fsPathToUri(p: string): string {
  return pathToFileURL(p).toString();
}

/** target 是否落在 root 內（含 root；字串層）。 */
function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/** 從 LSP request params 取 textDocument.uri（若有）。 */
function extractUri(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null;
  const td = (params as { textDocument?: unknown }).textDocument;
  if (!td || typeof td !== 'object') return null;
  const uri = (td as { uri?: unknown }).uri;
  return typeof uri === 'string' ? uri : null;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message || fallback : fallback;
}

type TimeoutResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface ServerEntry {
  child: LspChild;
  conn: LspConnection;
  ready: Promise<boolean>;
  alive: boolean;
  openUris: Set<string>;
}

export class LspManager {
  private readonly servers = new Map<string, ServerEntry>();
  private readonly spawn: LspSpawnFn;
  private readonly connect: LspConnectFactory;
  private readonly probeFn: (langId: string, excludeDirs: string[]) => LspServerInfo;
  private readonly emitDiagnostics: (payload: EventChannels['lsp:diagnostics']) => void;
  private readonly treeKill: (pid: number) => void | Promise<void>;
  private readonly runInstall: (file: string, args: string[]) => Promise<void>;
  private readonly requestTimeoutMs: number;
  private readonly initTimeoutMs: number;
  private readonly maxFileBytes: number;
  private readonly maxDiagnostics: number;

  constructor(
    private readonly workspaces: LspWorkspaceView,
    lifecycle: WorkspaceLifecycle,
    deps: LspDeps = {},
  ) {
    this.spawn = deps.spawn ?? defaultSpawn;
    this.connect = deps.connect ?? defaultConnect;
    this.probeFn = deps.probe ?? ((langId, exclude) => probeServer(langId, { excludeDirs: exclude }));
    this.emitDiagnostics = deps.emitDiagnostics ?? ((p) => emit('lsp:diagnostics', p));
    this.treeKill = deps.treeKill ?? defaultTreeKill;
    this.runInstall = deps.runInstall ?? defaultRunInstall;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.initTimeoutMs = deps.initTimeoutMs ?? INIT_TIMEOUT_MS;
    this.maxFileBytes = deps.maxFileBytes ?? MAX_FILE_BYTES;
    this.maxDiagnostics = deps.maxDiagnostics ?? MAX_DIAGNOSTICS;
    // 移除/切換工作區、關 app → 殺該 ws 所有 LS（含子程序樹），避免殭屍（REQ-WS-009，A5）。
    lifecycle.register('lsp', (wsId) => this.killWorkspace(wsId));
  }

  // ── lsp:probe ──
  probe(langId: string): LspServerInfo {
    return this.probeFn(langId, this.workspacePaths());
  }

  // ── lsp:install ──
  async install(langId: string): Promise<InvokeRes<'lsp:install'>> {
    const desc = byLangId(langId);
    if (!desc) return { error: '未知語言伺服器', manual: '' };
    if (!desc.installable || !desc.installCmd) {
      return { error: `${desc.serverId} 無法自動安裝`, manual: desc.installHint };
    }
    // 安裝工具本身也走「PATH 內、非工作區」絕對路徑解析（A2），避免安裝期 cwd 劫持。
    const bin = resolveOnPath(desc.installCmd.file, { excludeDirs: this.workspacePaths() });
    if (!bin) return { error: `找不到安裝工具 ${desc.installCmd.file}`, manual: desc.installHint };
    try {
      await this.runInstall(bin, desc.installCmd.args);
      return { ok: true };
    } catch (e) {
      return { error: errMsg(e, '安裝失敗'), manual: desc.installHint };
    }
  }

  // ── lsp:sync（didOpen/didChange/didClose）──
  async sync(req: InvokeReq<'lsp:sync'>): Promise<InvokeRes<'lsp:sync'>> {
    const ws = this.guardWorkspace(req.wsId);
    if (!ws) return { ok: true }; // 未信任/未啟動/未知 → 不擋編輯，降級
    if (!byLangId(req.langId)) return { ok: true };
    if (!(await this.uriAllowed(ws.path, req.uri))) return { ok: true }; // A3 uri 邊界
    if (req.kind === 'open' && (req.text?.length ?? 0) > this.maxFileBytes) {
      return { ok: true }; // A4 巨檔降級（不啟 LSP）
    }

    const entry = await this.ensureServer(req.wsId, req.langId, ws.path);
    if (!entry || !entry.alive) return { ok: true };
    try {
      if (req.kind === 'open') {
        entry.openUris.add(req.uri);
        entry.conn.sendNotification('textDocument/didOpen', {
          textDocument: { uri: req.uri, languageId: req.langId, version: req.version, text: req.text ?? '' },
        });
      } else if (req.kind === 'change') {
        entry.conn.sendNotification('textDocument/didChange', {
          textDocument: { uri: req.uri, version: req.version },
          contentChanges: [{ text: req.text ?? '' }],
        });
      } else {
        entry.openUris.delete(req.uri);
        entry.conn.sendNotification('textDocument/didClose', { textDocument: { uri: req.uri } });
      }
    } catch {
      /* 伺服器中途掛掉：降級，不崩潰 */
    }
    return { ok: true };
  }

  // ── lsp:request（completion/hover/definition…）──
  async request(
    wsId: string,
    langId: string,
    method: string,
    params: unknown,
  ): Promise<InvokeRes<'lsp:request'>> {
    if (!ALLOWED_METHODS.has(method)) return { error: 'method-not-allowed' }; // A3 白名單（先擋、不 spawn）
    const ws = this.guardWorkspace(wsId);
    if (!ws) return { error: 'workspace-not-allowed' };
    const uri = extractUri(params);
    if (uri !== null && !(await this.uriAllowed(ws.path, uri))) {
      return { error: 'uri-out-of-workspace' };
    }
    if (!byLangId(langId)) return { error: 'no-server' };

    const entry = await this.ensureServer(wsId, langId, ws.path);
    if (!entry || !entry.alive) return { error: 'no-server' };
    const r = await this.withTimeout(entry.conn.sendRequest(method, params), this.requestTimeoutMs);
    if (!r.ok) return { error: r.error }; // 逾時/失敗回 error（A5：不靜默永久 pending）
    return { result: r.value };
  }

  // ── teardown ──
  /** 殺該 ws 所有 LS（含子程序樹）；resolve 於所有 tree kill 完成（app 關閉路徑 await 用）。 */
  killWorkspace(wsId: string): Promise<void> {
    const prefix = `${wsId}::`;
    const kills: Promise<void>[] = [];
    for (const key of [...this.servers.keys()]) {
      if (key.startsWith(prefix)) kills.push(this.dropServer(key));
    }
    return Promise.all(kills).then(() => undefined);
  }

  /** 存活伺服器數（測試用）。 */
  get serverCount(): number {
    return this.servers.size;
  }

  // ── 內部 ──

  private workspacePaths(): string[] {
    try {
      return this.workspaces.list().map((w) => w.path);
    } catch {
      return [];
    }
  }

  /** 工作區須存在 + 信任 + 已 activate（A1/A3）。回路徑或 null。 */
  private guardWorkspace(wsId: string): { path: string } | null {
    const ws = this.workspaces.get(wsId);
    if (!ws || !ws.trusted || !ws.hydrated) return null;
    return { path: ws.path };
  }

  /** uri 正規化後須落在工作區根內（A3：擋 ../、絕對外部、symlink 逃逸）。 */
  private async uriAllowed(wsPath: string, uri: string): Promise<boolean> {
    const fsPath = uriToFsPath(uri);
    if (fsPath === null) return false;
    const root = resolve(wsPath);
    const target = resolve(fsPath);
    if (!isContained(root, target)) return false; // 字串層先擋
    try {
      const realRoot = await fsp.realpath(root);
      const realTarget = await fsp.realpath(target);
      if (!isContained(realRoot, realTarget)) return false; // symlink/junction 逃逸
    } catch {
      /* 目標尚不存在（新檔）→ 倚賴字串層判定 */
    }
    return true;
  }

  /** 取得（lazy 建立）某 (wsId, serverId) 的 LS 連線；未信任/不可用/啟動失敗回 null。 */
  private ensureServer(wsId: string, langId: string, wsPath: string): Promise<ServerEntry | null> {
    const desc = byLangId(langId);
    if (!desc) return Promise.resolve(null);
    const key = `${wsId}::${desc.serverId}`;
    const existing = this.servers.get(key);
    if (existing) return existing.ready.then((ok) => (ok && existing.alive ? existing : null));

    // A2：解析「PATH 內、非任何工作區」的絕對路徑；裸名永不入 spawn
    const info = this.probeFn(langId, this.workspacePaths());
    if (!info.available || !info.command) return Promise.resolve(null);

    let child: LspChild;
    try {
      child = this.spawn(info.command, desc.args, {
        cwd: wsPath,
        // A1 + REQ-SEC-002：白名單最小 env（不漏繼承 GIT_*/機密/注入向量給半可信工作區的語言伺服器），疊 GOTOOLCHAIN。
        env: buildSpawnEnv({ GOTOOLCHAIN: 'local' }),
      });
    } catch {
      return Promise.resolve(null);
    }

    const conn = this.connect(child, () => void this.dropServer(key));
    const entry: ServerEntry = { child, conn, alive: true, openUris: new Set(), ready: Promise.resolve(false) };
    this.servers.set(key, entry);

    // A5：spawn error / 程序 exit / 連線 close 任一 → 清理降級（不影響編輯/存檔）
    child.on('error', () => void this.dropServer(key));
    child.on('exit', () => void this.dropServer(key));
    conn.onClose(() => void this.dropServer(key));
    conn.onError(() => {
      /* 連線層錯誤非致命：記錄即可，保留連線交由 close/exit 收尾 */
    });
    conn.onNotification('textDocument/publishDiagnostics', (p) => this.onDiagnostics(wsId, p));
    conn.listen();

    entry.ready = this.initialize(conn, wsPath).then(
      () => entry.alive,
      () => {
        void this.dropServer(key);
        return false;
      },
    );
    return entry.ready.then((ok) => (ok && entry.alive ? entry : null));
  }

  private async initialize(conn: LspConnection, wsPath: string): Promise<void> {
    const rootUri = fsPathToUri(wsPath);
    const params = {
      processId: typeof process.pid === 'number' ? process.pid : null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          publishDiagnostics: {},
        },
        workspace: { workspaceFolders: true },
      },
    };
    const r = await this.withTimeout(conn.sendRequest('initialize', params), this.initTimeoutMs);
    if (!r.ok) throw new Error(`initialize 失敗：${r.error}`);
    conn.sendNotification('initialized', {});
  }

  private onDiagnostics(wsId: string, p: unknown): void {
    if (!p || typeof p !== 'object') return;
    const o = p as { uri?: unknown; diagnostics?: unknown };
    if (typeof o.uri !== 'string') return;
    const diags = Array.isArray(o.diagnostics) ? o.diagnostics.slice(0, this.maxDiagnostics) : [];
    this.emitDiagnostics({ wsId, uri: o.uri, diagnostics: diags }); // A4：截斷數量上限
  }

  private dropServer(key: string): Promise<void> {
    const e = this.servers.get(key);
    if (!e) return Promise.resolve();
    this.servers.delete(key);
    e.alive = false;
    try {
      e.conn.dispose();
    } catch {
      /* ignore */
    }
    const pid = e.child.pid;
    let killed: void | Promise<void> = undefined;
    if (typeof pid === 'number' && pid > 0) {
      try {
        killed = this.treeKill(pid); // A5：殺整個 process tree（含 java/go build 等衍生子程序）
      } catch {
        /* best-effort */
      }
    }
    try {
      e.child.kill();
    } catch {
      /* 可能已被 treeKill 殺掉 */
    }
    return Promise.resolve(killed).then(
      () => undefined,
      () => undefined,
    );
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
    return new Promise((res) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          res({ ok: false, error: 'timeout' });
        }
      }, ms);
      if (typeof timer.unref === 'function') timer.unref();
      p.then(
        (value) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            res({ ok: true, value });
          }
        },
        (err) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            res({ ok: false, error: errMsg(err, 'request 失敗') });
          }
        },
      );
    });
  }
}

/**
 * 註冊 lsp:* handlers（取代 stub）。router 改呼：
 *   registerLspHandlers(ipcMain, services.workspaces, services.lifecycle)
 */
export function registerLspHandlers(
  ipc: IpcMain,
  workspaces: WorkspaceManager,
  lifecycle: WorkspaceLifecycle,
): LspManager {
  const mgr = new LspManager(workspaces, lifecycle);
  ipc.handle('lsp:probe', (_e, req: InvokeReq<'lsp:probe'>) => mgr.probe(req.langId));
  ipc.handle('lsp:install', (_e, req: InvokeReq<'lsp:install'>) => mgr.install(req.langId));
  ipc.handle('lsp:request', (_e, req: InvokeReq<'lsp:request'>) =>
    mgr.request(req.wsId, req.langId, req.method, req.params),
  );
  ipc.handle('lsp:sync', (_e, req: InvokeReq<'lsp:sync'>) => mgr.sync(req));
  return mgr;
}
