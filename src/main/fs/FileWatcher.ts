// 檔案總管樹（fs:tree）+ 每工作區檔案監看（FileWatcher，REQ-WS-004 / REQ-MON-005/006）。
//
// 安全模型（REQ-SEC-003 半可信工作區）：加入工作區＝一次信任授權，但工作區「內容」半可信，
// 故 fs:tree 的 dir 一律約束在 workspace.path 內：
//   - 字串層：path.resolve 後做 containment（擋 ../ 穿越、絕對路徑、跨磁碟/UNC/device 前綴）。
//   - symlink 層：以 fs.realpath 解析後再比對 realRoot（擋 repo 內 symlink/junction 逃逸）。
// watcher 走 followSymlinks:false（不跟 symlink 出界）+ ignored 以「路徑分段」比對（chokidar v5
// 已無 glob，子字串/glob 寫法會漏放 node_modules/.git）+ awaitWriteFinish 去半寫多發 +
// 時間窗 coalesce（同窗同檔去重）。fs:change 為「逐檔」語意，path＝「workspace 相對 POSIX 路徑」
// （與 editorBus.openFile / fs:read 同一路徑約定，'' 代表工作區根），kind＝add/change/unlink；
// 編輯器（F-4）以此 path 字串比對開啟分頁、偵測外部修改，檔案總管據此重抓父目錄——故 watcher
// 必須發相對路徑（非 chokidar 的絕對路徑），否則 F-4 分頁鍵對不上、且會把絕對路徑洩漏給 renderer。
// 事件洪水防護＝flood breaker：一波內逐筆推送至上限後切「coarse 模式」，改推單一根目錄重抓訊號
// （path=''、kind='change'），並在該波靜止後補一次根目錄重抓對帳；避免上千事件灌爆 renderer
// 主執行緒（REQ-MON-006），同時保留正常多檔存檔的逐檔精度。
// lazy 啟動：首次 fs:tree(wsId) 才建 watcher；ensureWatch 冪等（同 wsId 並發只建一個，
// 杜絕 StrictMode 雙呼/雙面板造成的重複事件與殭屍 watcher）。teardown 經 lifecycle 完整收尾。

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import chokidar, { type FSWatcher, type ChokidarOptions } from 'chokidar';
import type { IpcMain } from 'electron';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import type { InvokeReq, EventChannels } from '../../shared/ipc';
import { IGNORED_DIRS } from '../../shared/constants';
import { emit } from '../ipc/broadcast';

export type TreeEntry = { name: string; dir: boolean };
type FsKind = EventChannels['fs:change']['kind'];

/** chokidar.watch 注入點（測試以 spy/假 watcher 取代真實檔案系統監看）。 */
export type WatchFactory = (root: string, options: ChokidarOptions) => FSWatcher;

export interface FileWatcherOptions {
  /** fs:change 推送函式（預設經 broadcast.emit 推給 renderer）。 */
  emit?: (payload: EventChannels['fs:change']) => void;
  /** watcher 建構工廠（預設 chokidar.watch）。 */
  watchFactory?: WatchFactory;
  /** 事件聚合時間窗（ms）。 */
  coalesceMs?: number;
  /** awaitWriteFinish 穩定門檻（ms）；半寫多發收斂成單一事件。 */
  awaitWriteFinishMs?: number;
  /** 一波內逐檔推送上限；累計超量切 coarse 模式（改推單一根目錄重抓）。 */
  maxBatch?: number;
}

const DEFAULT_COALESCE_MS = 60;
const DEFAULT_AWF_MS = 80;
const DEFAULT_MAX_BATCH = 100;
const WATCH_DEPTH = 16;
/** 一波事件靜止判定（須 > coalesceMs；靜止後若處於 coarse 則補一次根目錄對帳並重置）。 */
const IDLE_FACTOR = 3;
const MIN_IDLE_MS = 250;

const IGNORED_SET: ReadonlySet<string> = new Set<string>(IGNORED_DIRS);

/** UNC（\\server\share）/ device（\\.\）/ extended-length（\\?\）前綴：一律拒絕，避免 NTLM 外洩與卡死。 */
function hasDangerousPrefix(dir: string): boolean {
  const s = dir.trim();
  return s.startsWith('\\\\') || s.startsWith('//');
}

/** workspace 內的絕對路徑 → 相對 POSIX（'/' 分隔；root 本身回 ''）。fs:change 對外一律此格式。 */
function toRelPosix(root: string, full: string): string {
  const rel = path.relative(root, full);
  return rel === '' ? '' : rel.split(path.sep).join('/');
}

/** target 是否落在 root 內（含 root 本身）；以 path.relative 判斷，跨平台、case 由 path 處理。 */
function isContained(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || rel.startsWith('../')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * 把 dir 解析成「保證在 workspace 內」的真實路徑；任何越界/可疑/不存在一律回 null。
 * 順序：危險前綴 → 字串 containment（不碰 fs）→ realpath 後再 containment（擋 symlink）。
 */
async function resolveInWorkspace(root: string, dir: string): Promise<string | null> {
  if (typeof dir !== 'string') return null;
  if (hasDangerousPrefix(dir)) return null;
  const abs = path.resolve(root, dir);
  if (!isContained(root, abs)) return null; // 字串層先擋：越界路徑連 realpath/readdir 都不碰
  let realRoot: string;
  let realAbs: string;
  try {
    realRoot = await fsp.realpath(root);
    realAbs = await fsp.realpath(abs);
  } catch {
    return null; // 不存在 / 權限 / 保留名（CON 等）→ 視為空
  }
  if (!isContained(realRoot, realAbs)) return null; // symlink/junction 逃逸：實體路徑出界
  return realAbs;
}

/**
 * 列出 dir 下 entries（name + dir:boolean）。越界/權限錯誤一律回 {entries:[]}（不拋、不洩漏）。
 * symlink 一律標 dir:false（不可由樹展開，避免經 symlink 逃逸列舉）。
 */
export async function listTree(root: string, dir: string): Promise<{ entries: TreeEntry[] }> {
  const real = await resolveInWorkspace(root, dir);
  if (!real) return { entries: [] };
  let dirents;
  try {
    dirents = await fsp.readdir(real, { withFileTypes: true });
  } catch {
    return { entries: [] }; // 權限錯誤略過回空（REQ-MON-005）
  }
  const entries: TreeEntry[] = dirents.map((d) => ({ name: d.name, dir: d.isDirectory() }));
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries };
}

/** 多工作區檔案監看管理（每工作區一個 chokidar watcher，lazy 建、teardown 收）。 */
export class FileWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly ready = new Map<string, Promise<void>>();
  /** 每工作區同窗待推送的逐檔事件（路徑→kind，去重同窗同檔；last-wins）。 */
  private readonly pending = new Map<string, Map<string, FsKind>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** flood breaker 狀態：本波已逐檔推送數、是否已切 coarse、靜止計時器。 */
  private readonly burstEmitted = new Map<string, number>();
  private readonly coarse = new Set<string>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly resolveRoot: (wsId: string) => string | undefined,
    private readonly opts: FileWatcherOptions = {},
  ) {}

  private get coalesceMs(): number {
    return this.opts.coalesceMs ?? DEFAULT_COALESCE_MS;
  }
  private get maxBatch(): number {
    return this.opts.maxBatch ?? DEFAULT_MAX_BATCH;
  }
  private get idleMs(): number {
    return Math.max(MIN_IDLE_MS, this.coalesceMs * IDLE_FACTOR);
  }

  private buildOptions(root: string): ChokidarOptions {
    const awf = this.opts.awaitWriteFinishMs ?? DEFAULT_AWF_MS;
    return {
      ignored: (full: string) => this.isIgnored(root, full),
      ignoreInitial: true,
      followSymlinks: false, // symlink 不跟出界（A2）；symlink 視為檔不遞迴
      depth: WATCH_DEPTH,
      ignorePermissionErrors: true,
      awaitWriteFinish: { stabilityThreshold: awf, pollInterval: Math.max(20, Math.floor(awf / 4)) },
    };
  }

  /** 路徑分段比對忽略目錄（chokidar v5 無 glob；子字串會誤判，分段才正確跨巢狀/跨平台）。 */
  private isIgnored(root: string, full: string): boolean {
    const rel = path.relative(root, full);
    if (!rel || rel.startsWith('..')) return false; // root 本身或界外：此處不忽略
    for (const seg of rel.split(/[\\/]/)) {
      if (IGNORED_SET.has(seg)) return true;
    }
    return false;
  }

  /** 冪等啟動某工作區的 watcher（同 wsId 並發只建一個；root 缺則 no-op）。 */
  ensureWatch(wsId: string): void {
    if (this.watchers.has(wsId)) return; // 同步 check-set，無 await 隙縫＝race-safe（A4）
    const root = this.resolveRoot(wsId);
    if (!root) return;
    const factory = this.opts.watchFactory ?? ((r, o) => chokidar.watch(r, o));
    const w = factory(root, this.buildOptions(root));
    this.watchers.set(wsId, w);
    this.ready.set(wsId, new Promise<void>((res) => w.once('ready', () => res())));
    w.on('add', (p: string) => this.enqueue(wsId, root, p, 'add'));
    w.on('change', (p: string) => this.enqueue(wsId, root, p, 'change'));
    w.on('unlink', (p: string) => this.enqueue(wsId, root, p, 'unlink'));
    w.on('addDir', (p: string) => this.enqueue(wsId, root, p, 'add'));
    w.on('unlinkDir', (p: string) => this.enqueue(wsId, root, p, 'unlink'));
    w.on('error', () => {
      /* watcher 內部錯誤（EPERM 等）隔離，不讓背景監看打斷主流程 */
    });
  }

  /** 等待某 wsId 的 watcher ready（測試用；未啟動則立即 resolve）。 */
  whenReady(wsId: string): Promise<void> {
    return this.ready.get(wsId) ?? Promise.resolve();
  }

  /** 存活 watcher 數（測試用）。 */
  get size(): number {
    return this.watchers.size;
  }

  private enqueue(wsId: string, root: string, full: string, kind: FsKind): void {
    if (!isContained(root, full)) return; // 防衛縱深：界外路徑一律不發（A2）
    const rel = toRelPosix(root, full); // 對外發相對 POSIX（與 openFile/fs:read 同約定）
    let buf = this.pending.get(wsId);
    if (!buf) {
      buf = new Map<string, FsKind>();
      this.pending.set(wsId, buf);
    }
    buf.set(rel, kind); // 同窗同檔去重，last-wins
    if (!this.timers.has(wsId)) {
      const t = setTimeout(() => this.flush(wsId), this.coalesceMs);
      if (typeof t.unref === 'function') t.unref();
      this.timers.set(wsId, t);
    }
    this.armIdle(wsId); // 每次事件都延後靜止判定
  }

  /** 重置「本波靜止」計時器：靜止後若處於 coarse，補一次根目錄對帳並重置 flood 狀態。 */
  private armIdle(wsId: string): void {
    const prev = this.idleTimers.get(wsId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.idleTimers.delete(wsId);
      if (this.coarse.has(wsId)) {
        this.push({ wsId, path: '', kind: 'change' }); // 波結束對帳：renderer 重抓根（'' = 工作區根）
      }
      this.coarse.delete(wsId);
      this.burstEmitted.set(wsId, 0);
    }, this.idleMs);
    if (typeof t.unref === 'function') t.unref();
    this.idleTimers.set(wsId, t);
  }

  private flush(wsId: string): void {
    this.timers.delete(wsId);
    const buf = this.pending.get(wsId);
    this.pending.delete(wsId);
    if (!buf || buf.size === 0) return;

    // 已在 coarse：本波已發過根目錄重抓訊號，逐筆抑制（靜止時補最終對帳）。
    if (this.coarse.has(wsId)) return;

    const emitted = this.burstEmitted.get(wsId) ?? 0;
    if (emitted + buf.size > this.maxBatch) {
      // 事件洪水：切 coarse，改推單一根目錄重抓訊號（A5；逐檔精度讓位給有界性）。
      this.coarse.add(wsId);
      this.push({ wsId, path: '', kind: 'change' });
      return;
    }
    for (const [p, kind] of buf) this.push({ wsId, path: p, kind });
    this.burstEmitted.set(wsId, emitted + buf.size);
  }

  private push(payload: EventChannels['fs:change']): void {
    (this.opts.emit ?? ((p) => emit('fs:change', p)))(payload);
  }

  /** 收尾某工作區 watcher（移除/teardown）：清計時器/緩衝、close watcher、從表移除（無殭屍）。 */
  async teardown(wsId: string): Promise<void> {
    const w = this.watchers.get(wsId);
    this.watchers.delete(wsId);
    this.ready.delete(wsId);
    this.pending.delete(wsId);
    this.burstEmitted.delete(wsId);
    this.coarse.delete(wsId);
    const t = this.timers.get(wsId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(wsId);
    }
    const it = this.idleTimers.get(wsId);
    if (it) {
      clearTimeout(it);
      this.idleTimers.delete(wsId);
    }
    if (w) await w.close();
  }

  /** 收尾全部（app 退出用）。 */
  async closeAll(): Promise<void> {
    await Promise.all([...this.watchers.keys()].map((id) => this.teardown(id)));
  }
}

/**
 * 註冊 fs:tree handler + 接上工作區檔案監看（取代 fs stub 中的 fs:tree）。
 * lazy：首次 fs:tree(wsId) 觸發該工作區 watcher；teardown 經 lifecycle('watcher') 收尾。
 * 回傳 FileWatcher 供 app 生命週期（closeAll）取用。
 */
export function registerFsTreeAndWatch(
  ipc: IpcMain,
  workspaces: WorkspaceManager,
  lifecycle: WorkspaceLifecycle,
  opts: FileWatcherOptions = {},
): FileWatcher {
  const fw = new FileWatcher((wsId) => workspaces.get(wsId)?.path, opts);
  lifecycle.register('watcher', (wsId) => fw.teardown(wsId));

  ipc.handle('fs:tree', async (_e, req: InvokeReq<'fs:tree'>) => {
    const root = workspaces.get(req.wsId)?.path;
    if (!root) return { entries: [] };
    fw.ensureWatch(req.wsId); // lazy 啟動（同步、冪等）
    return listTree(root, req.dir);
  });

  return fw;
}
