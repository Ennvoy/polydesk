// 全域搜尋後端（F-6：REQ-SEARCH-001~005、REQ-E2E-006）。
// 以內建 @vscode/ripgrep 的 rg 執行檔 spawn，串流 stdout 逐行解析成 SearchHit，分批 emit
// 'search:result' 給 renderer（不卡 UI）；達上限截斷、可取消、會自動回收程序。
//
// 安全硬化（紅軍 A1~A5）：
//  - A1：spawn rg 走「白名單最小 env」（顯式排除 RIPGREP_CONFIG_PATH / RIPGREP_*，避免半可信 repo
//        以 config 的 --pre 達成零點擊 RCE）；query 一律以 `-e <query>` 隔離、路徑以 `-- .` 收尾
//        （凡 `-` 開頭的搜尋詞被當 flag 的問題消失）；非 regex 加 --fixed-strings；永不傳 -L。
//  - A2：取代寫回復用 fileService 的 resolveSafe（realpath 邊界，擋 junction/symlink 逃逸寫到沙箱外）
//        + writeFileSafe（atomicWrite + readVersions 衝突偵測，外部已改回 conflict 不覆蓋）。
//  - A3：取代讀檔走 readFileSafe（原編碼偵測 + BOM 剝離），只替換命中片段、不做全域 EOL 正規化，
//        writeFileSafe 以原編碼往返（Big5/CRLF 保真）；含 NUL 的疑似二進位檔一律 skip。
//  - A4：search-as-you-type 以「同來源新搜尋自動取消舊搜尋」收斂存活 rg ≤ maxConcurrent；child
//        'close'/'error' 一律從 Map 移除；webContents 'destroyed' 時 killByOwner 殺殘留 child。
//  - A5：--max-columns 限制每行輸出 + 累加器單行硬上限（防巨大單行 OOM）+ 單筆 preview 上限；
//        child 'error'(spawn 失敗如 ENOENT) 與 'close'(任何 exit code，含 1=0 命中) 都收斂發 done:true
//        （UI 永不卡住）。打包時 rgPath 須隨 @vscode/ripgrep 一併 asarUnpack（見 integrationNotes）。

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
// @vscode/ripgrep 為 ESM-only：CJS main 不可 static import（require ESM → ERR_REQUIRE_ESM），
// 也不可 bundle（rgPath 靠自身位置解析平台 optional dep）。改 dynamic import() 延遲解析並快取。
let rgPathCache: string | null = null;
async function resolveRgPath(): Promise<string> {
  if (rgPathCache) return rgPathCache;
  const mod = (await import('@vscode/ripgrep')) as { rgPath: string };
  rgPathCache = mod.rgPath;
  return rgPathCache;
}
import type { IpcMain, WebContents } from 'electron';
import { IGNORED_DIRS, SEARCH_RESULT_LIMIT } from '../../shared/constants';
import type { SearchHit, FileEncoding, Eol } from '../../shared/types';
import type { InvokeReq, EventChannels } from '../../shared/ipc';
import { emit } from '../ipc/broadcast';
import { record } from '../../shared/perf';
import { resolveSafe, readFileSafe, writeFileSafe } from '../fs/fileService';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';

export type SearchOpts = InvokeReq<'search:run'>['opts'];

/** spawn 出來的 rg child 介面（node child_process.ChildProcess 相容；測試可注入 fake）。 */
export interface SearchChildStream {
  on(event: 'data', cb: (chunk: Buffer) => void): unknown;
}
export interface SearchChild {
  stdout: SearchChildStream | null;
  stderr?: SearchChildStream | null;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'close', cb: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}
export type SearchSpawnFn = (
  file: string,
  args: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => SearchChild;

const defaultSpawn: SearchSpawnFn = (file, args, opts) =>
  spawn(file, [...args], { cwd: opts.cwd, env: opts.env, windowsHide: true }) as unknown as SearchChild;

export interface SearchDeps {
  /** 結果推送（預設經 broadcast.emit('search:result')）。 */
  onResult?: (payload: EventChannels['search:result']) => void;
  /** rg child 工廠（預設真 child_process.spawn）。 */
  spawn?: SearchSpawnFn;
  /** rg 執行檔路徑（預設 @vscode/ripgrep 的 rgPath；測試可注入無效路徑驗 ENOENT 收斂）。 */
  rgPath?: string;
  /** 結果上限（達標截斷，預設 SEARCH_RESULT_LIMIT）。 */
  resultLimit?: number;
  /** 每批 hit 數（達標即推一批）。 */
  batchSize?: number;
  /** 批次時間窗（ms），不足 batchSize 也會在此窗後推出。 */
  flushIntervalMs?: number;
  /** 同來源最大同時存活 streaming 搜尋（預設 1：search-as-you-type 只留最新）。 */
  maxConcurrent?: number;
  /** stdout 單行累加器硬上限（bytes，超過視為失控巨大單行，丟棄，A5）。 */
  maxLineBytes?: number;
  /** 單筆 preview 字元上限。 */
  previewMax?: number;
  /** rg --max-columns 值（限制每行輸出長度，A5）。 */
  maxColumns?: number;
  /** rg -l 檔名清單 stdout 上限（bytes）。 */
  maxListBytes?: number;
}

interface ActiveSearch {
  kind: 'search' | 'replace';
  child: SearchChild | null;
  owner: unknown;
  cancelled: boolean;
  done: boolean;
  total: number;
  buf: Buffer;
  pending: SearchHit[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
}

/** workspace 相對 OS 路徑 → 相對 POSIX（與 editorBus.openFile / fs:read 同一約定）。 */
function toPosix(p: string): string {
  let s = p.split('\\').join('/');
  if (s.startsWith('./')) s = s.slice(2);
  return s;
}

/** rg -l --null 的 NUL 分隔檔名清單 → 相對 POSIX 路徑陣列。 */
function parseList(buf: Buffer): string[] {
  return buf
    .toString('utf8')
    .split('\0')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(toPosix);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 對 content 套用取代，回傳新內容與命中數；只替換命中片段、不碰其餘位元組（保 EOL/編碼，A3）。
 * - regex：以 query 建 RegExp（支援 $1 group ref 取代）。
 * - 非 regex：query 視為字面，replacement 也視為字面（不解讀 $）。
 * - 大小寫：caseSensitive 或 query 含大寫 → 區分；否則 smart-case 不區分（與搜尋一致）。
 */
export function applyReplacement(
  content: string,
  query: string,
  replacement: string,
  opts: { regex?: boolean; caseSensitive?: boolean },
): { next: string; count: number } {
  if (query.length === 0) return { next: content, count: 0 };
  const insensitive = !opts.caseSensitive && !/[A-Z]/.test(query);
  const flags = insensitive ? 'gi' : 'g';
  let re: RegExp;
  try {
    re = new RegExp(opts.regex ? query : escapeRegExp(query), flags);
  } catch {
    return { next: content, count: 0 }; // 非法 regex → 不動
  }
  if (opts.regex) {
    const matches = content.match(re);
    const count = matches ? matches.length : 0;
    if (count === 0) return { next: content, count: 0 };
    return { next: content.replace(re, replacement), count };
  }
  let count = 0;
  const next = content.replace(re, () => {
    count += 1;
    return replacement;
  });
  return { next, count };
}

export interface ReplacePlanItem {
  rel: string;
  next: string;
  encoding: FileEncoding;
  eol: Eol;
  count: number;
}
export interface ReplaceSkip {
  rel: string;
  reason: 'outside' | 'read-failed' | 'binary' | 'no-match';
}
export interface ReplaceResult {
  rel: string;
  status: 'replaced' | 'skipped';
  count: number;
  reason?: string;
}

/**
 * 取代第一相（讀＋規劃，不寫）：對每個命中檔過 resolveSafe（擋 junction/symlink 逃逸）→ readFileSafe
 * （原編碼偵測）→ NUL 二進位偵測 → applyReplacement，回傳可寫計畫與略過清單。讀寫分相讓「讀後外部
 * 改檔 → 寫回 conflict」可被偵測（A2）。
 */
export async function collectReplacements(
  mgr: WorkspaceManager,
  wsId: string,
  files: readonly string[],
  query: string,
  replacement: string,
  opts: { regex?: boolean; caseSensitive?: boolean },
  isCancelled?: () => boolean,
): Promise<{ plan: ReplacePlanItem[]; skipped: ReplaceSkip[] }> {
  const plan: ReplacePlanItem[] = [];
  const skipped: ReplaceSkip[] = [];
  for (const rel of files) {
    if (isCancelled?.()) break;
    const safe = resolveSafe(mgr, wsId, rel);
    if ('error' in safe) {
      skipped.push({ rel, reason: 'outside' }); // realpath 落在沙箱外（A2）
      continue;
    }
    let read;
    try {
      read = await readFileSafe(mgr, { wsId, path: rel });
    } catch {
      skipped.push({ rel, reason: 'read-failed' });
      continue;
    }
    if (read.content.indexOf(String.fromCharCode(0)) !== -1) {
      skipped.push({ rel, reason: 'binary' }); // 疑似二進位（含 NUL）不取代（A3）
      continue;
    }
    const { next, count } = applyReplacement(read.content, query, replacement, opts);
    if (count === 0) {
      skipped.push({ rel, reason: 'no-match' });
      continue;
    }
    plan.push({ rel, next, encoding: read.encoding, eol: read.eol, count });
  }
  return { plan, skipped };
}

/**
 * 取代第二相（寫）：每檔走 writeFileSafe（atomicWrite + readVersions 衝突偵測 + 原編碼往返，A2/A3）；
 * 外部已改回 conflict、唯讀回 permission，皆 skip 不假裝成功。
 */
export async function applyReplacements(
  mgr: WorkspaceManager,
  wsId: string,
  plan: readonly ReplacePlanItem[],
  isCancelled?: () => boolean,
): Promise<ReplaceResult[]> {
  const out: ReplaceResult[] = [];
  for (const item of plan) {
    if (isCancelled?.()) break;
    const w = await writeFileSafe(mgr, {
      wsId,
      path: item.rel,
      content: item.next,
      encoding: item.encoding,
      eol: item.eol,
    });
    if ('error' in w) out.push({ rel: item.rel, status: 'skipped', count: 0, reason: w.error });
    else out.push({ rel: item.rel, status: 'replaced', count: item.count });
  }
  return out;
}

export class SearchService {
  private readonly active = new Map<string, ActiveSearch>();
  private readonly onResult: (payload: EventChannels['search:result']) => void;
  private readonly spawnFn: SearchSpawnFn;
  /** 注入的 rg 路徑（測試用）；空字串＝production，延遲經 resolveRgPath() 取得。 */
  private readonly injectedRg: string;
  /** 取 rg 執行檔路徑：注入優先，否則延遲 dynamic import @vscode/ripgrep（快取）。 */
  private getRgBin(): Promise<string> {
    return this.injectedRg ? Promise.resolve(this.injectedRg) : resolveRgPath();
  }
  private readonly resultLimit: number;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxConcurrent: number;
  private readonly maxLineBytes: number;
  private readonly previewMax: number;
  private readonly maxColumns: number;
  private readonly maxListBytes: number;

  constructor(
    private readonly workspaces: WorkspaceManager,
    deps: SearchDeps = {},
  ) {
    this.onResult = deps.onResult ?? ((p) => emit('search:result', p));
    this.spawnFn = deps.spawn ?? defaultSpawn;
    this.injectedRg = deps.rgPath ?? '';
    this.resultLimit = deps.resultLimit ?? SEARCH_RESULT_LIMIT;
    this.batchSize = deps.batchSize ?? 50;
    this.flushIntervalMs = deps.flushIntervalMs ?? 100;
    this.maxConcurrent = Math.max(1, deps.maxConcurrent ?? 1);
    this.maxLineBytes = deps.maxLineBytes ?? 1024 * 1024;
    this.previewMax = deps.previewMax ?? 500;
    this.maxColumns = deps.maxColumns ?? 500;
    this.maxListBytes = deps.maxListBytes ?? 8 * 1024 * 1024;
  }

  /** 存活搜尋數（測試用）。 */
  get activeCount(): number {
    return this.active.size;
  }

  /** REQ-SEARCH-001/004：啟動搜尋（或取代）。回 searchId；結果走 'search:result' 串流。 */
  run(req: InvokeReq<'search:run'>, owner?: unknown): { searchId: string } {
    const searchId = randomUUID();
    const query = typeof req?.query === 'string' ? req.query : '';
    const opts: SearchOpts = req?.opts ?? {};
    const ws = this.workspaces.get(req?.wsId);
    if (!ws || ws.status !== 'ok' || query.length === 0) {
      // 無工作區 / 空查詢：立即收斂 done，UI 不卡（A5 精神）。
      queueMicrotask(() => this.onResult({ searchId, hits: [], done: true, truncated: false }));
      return { searchId };
    }
    const isReplace = typeof opts.replace === 'string';
    const a: ActiveSearch = {
      kind: isReplace ? 'replace' : 'search',
      child: null,
      owner,
      cancelled: false,
      done: false,
      total: 0,
      buf: Buffer.alloc(0),
      pending: [],
      flushTimer: null,
      startedAt: performance.now(),
    };
    if (!isReplace) this.enforceCap(); // 新 streaming 進場前先收斂舊的（A4）
    this.active.set(searchId, a);
    if (isReplace) void this.runReplace(searchId, req.wsId, ws.path, query, opts.replace as string, opts);
    else void this.spawnSearch(searchId, ws.path, query, opts);
    return { searchId };
  }

  /** REQ-SEARCH-005：取消搜尋（kill 對應 rg + 之後不再 emit）。 */
  cancel(req: InvokeReq<'search:cancel'>): { ok: true } {
    const a = this.active.get(req?.searchId);
    if (a) {
      a.cancelled = true;
      this.cleanup(req.searchId, true);
    }
    return { ok: true };
  }

  /** 殺某 owner（如 webContents）名下所有殘留搜尋（renderer reload/destroy，A4）。 */
  killByOwner(owner: unknown): void {
    for (const [id, a] of [...this.active]) {
      if (a.owner === owner) {
        a.cancelled = true;
        this.cleanup(id, true);
      }
    }
  }

  /** 殺全部（app teardown）。 */
  killAll(): void {
    for (const [id, a] of [...this.active]) {
      a.cancelled = true;
      this.cleanup(id, true);
    }
  }

  // ── 內部：streaming 搜尋 ──────────────────────────────────────────────

  private async spawnSearch(searchId: string, cwd: string, query: string, opts: SearchOpts): Promise<void> {
    const a = this.active.get(searchId);
    if (!a) return;
    let rg: string;
    try {
      rg = await this.getRgBin();
    } catch {
      this.emitDone(searchId, false, []);
      return;
    }
    if (a.cancelled) return; // 解析 rg 期間可能已被取消
    let child: SearchChild;
    try {
      child = this.spawnFn(rg, this.searchArgs(query, opts), { cwd, env: this.buildEnv() });
    } catch {
      this.emitDone(searchId, false, []); // 同步 spawn 失敗也收斂 done
      return;
    }
    a.child = child;
    child.stdout?.on('data', (c: Buffer) => this.onStdout(searchId, c));
    child.stderr?.on('data', () => {
      /* 排空 stderr 防 backpressure；內容忽略（exit code 已足夠判斷） */
    });
    child.on('error', () => this.emitDone(searchId, false, [])); // ENOENT 等：收斂 done（A5）
    child.on('close', () => this.emitDone(searchId, false)); // exit 0/1/≥2 一律收斂 done（A5）
  }

  private onStdout(searchId: string, chunk: Buffer): void {
    const a = this.active.get(searchId);
    if (!a || a.cancelled || a.done) return;
    const data = a.buf.length ? Buffer.concat([a.buf, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const nl = data.indexOf(0x0a, start);
      if (nl < 0) break;
      const hit = this.parseLine(data.subarray(start, nl));
      start = nl + 1;
      if (hit) {
        this.addHit(searchId, hit);
        const cur = this.active.get(searchId);
        if (!cur || cur.done || cur.cancelled) return; // 達上限/取消：停止解析
      }
    }
    const remainder = data.subarray(start);
    // 失控巨大單行（無換行且超上限）→ 丟棄累加器，杜絕無界成長 OOM（A5）。
    a.buf = remainder.length > this.maxLineBytes ? Buffer.alloc(0) : Buffer.from(remainder);
  }

  /** 解析 rg `path\0line:col:text` 一行 → SearchHit（preview 截斷、剝行尾 \r）。 */
  private parseLine(lineBuf: Buffer): SearchHit | null {
    const nul = lineBuf.indexOf(0x00);
    if (nul < 0) return null;
    const path = toPosix(lineBuf.subarray(0, nul).toString('utf8'));
    const rest = lineBuf.subarray(nul + 1).toString('utf8');
    const c1 = rest.indexOf(':');
    if (c1 < 0) return null;
    const line = Number.parseInt(rest.slice(0, c1), 10);
    const rest2 = rest.slice(c1 + 1);
    const c2 = rest2.indexOf(':');
    if (c2 < 0) return null;
    const col = Number.parseInt(rest2.slice(0, c2), 10);
    if (!Number.isFinite(line) || !Number.isFinite(col)) return null;
    let preview = rest2.slice(c2 + 1);
    if (preview.endsWith('\r')) preview = preview.slice(0, -1);
    if (preview.length > this.previewMax) preview = preview.slice(0, this.previewMax);
    return { path, line, col, preview };
  }

  private addHit(searchId: string, hit: SearchHit): void {
    const a = this.active.get(searchId);
    if (!a || a.cancelled || a.done) return;
    a.total += 1;
    a.pending.push(hit);
    if (a.total >= this.resultLimit) {
      this.emitDone(searchId, true); // 達上限：截斷 + 收尾 + kill（A5）
      return;
    }
    if (a.pending.length >= this.batchSize) {
      this.flush(searchId);
      return;
    }
    if (!a.flushTimer) {
      a.flushTimer = setTimeout(() => this.flush(searchId), this.flushIntervalMs);
      if (typeof a.flushTimer.unref === 'function') a.flushTimer.unref();
    }
  }

  private flush(searchId: string): void {
    const a = this.active.get(searchId);
    if (!a || a.cancelled || a.done) return;
    if (a.flushTimer) {
      clearTimeout(a.flushTimer);
      a.flushTimer = null;
    }
    if (a.pending.length === 0) return;
    const hits = a.pending;
    a.pending = [];
    this.onResult({ searchId, hits, done: false, truncated: false });
  }

  private emitDone(searchId: string, truncated: boolean, hits?: SearchHit[]): void {
    const a = this.active.get(searchId);
    if (!a || a.cancelled || a.done) return;
    a.done = true;
    if (a.flushTimer) {
      clearTimeout(a.flushTimer);
      a.flushTimer = null;
    }
    const finalHits = hits ?? a.pending;
    a.pending = [];
    this.recordDuration(a);
    this.onResult({ searchId, hits: finalHits, done: true, truncated });
    this.cleanup(searchId, true);
  }

  // ── 內部：取代 ────────────────────────────────────────────────────────

  private async runReplace(
    searchId: string,
    wsId: string,
    cwd: string,
    query: string,
    replacement: string,
    opts: SearchOpts,
  ): Promise<void> {
    try {
      const files = await this.listMatchFiles(searchId, cwd, query, opts);
      if (this.isCancelled(searchId)) return;
      const a = this.active.get(searchId);
      if (a) a.child = null;
      const { plan } = await collectReplacements(this.workspaces, wsId, files, query, replacement, opts, () =>
        this.isCancelled(searchId),
      );
      if (this.isCancelled(searchId)) return;
      const results = await applyReplacements(this.workspaces, wsId, plan, () => this.isCancelled(searchId));
      if (this.isCancelled(searchId)) return;
      const hits: SearchHit[] = results
        .filter((r) => r.status === 'replaced')
        .map((r) => ({ path: r.rel, line: 1, col: 1, preview: `已取代 ${r.count} 處` }));
      this.emitDone(searchId, false, hits);
    } catch {
      this.emitDone(searchId, false, []); // 任何錯誤都收斂 done，UI 不卡
    }
  }

  /** rg -l --null：列出含命中的檔（相對 POSIX）。child 存進 active 以利取代期間 cancel。 */
  private async listMatchFiles(searchId: string, cwd: string, query: string, opts: SearchOpts): Promise<string[]> {
    const rg = await this.getRgBin();
    return new Promise((resolve) => {
      let child: SearchChild;
      try {
        child = this.spawnFn(rg, this.listArgs(query, opts), { cwd, env: this.buildEnv() });
      } catch {
        resolve([]);
        return;
      }
      const a = this.active.get(searchId);
      if (a) a.child = child;
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (files: string[]): void => {
        if (!settled) {
          settled = true;
          resolve(files);
        }
      };
      child.stdout?.on('data', (c: Buffer) => {
        size += c.length;
        if (size > this.maxListBytes) {
          this.killChild(child);
          finish(parseList(Buffer.concat(chunks)));
          return;
        }
        chunks.push(c);
      });
      child.stderr?.on('data', () => {});
      child.on('error', () => finish([]));
      child.on('close', () => finish(parseList(Buffer.concat(chunks))));
    });
  }

  // ── 內部：共用 ────────────────────────────────────────────────────────

  private baseFlags(opts: SearchOpts): string[] {
    const f: string[] = ['--color=never'];
    f.push(opts.caseSensitive ? '--case-sensitive' : '--smart-case');
    if (!opts.regex) f.push('--fixed-strings');
    for (const dir of IGNORED_DIRS) f.push('--glob', `!${dir}`);
    return f;
  }

  /** 搜尋 argv：query 以 -e 隔離、路徑 `-- .` 收尾、限制單行長度（A1/A5）。 */
  private searchArgs(query: string, opts: SearchOpts): string[] {
    return [
      ...this.baseFlags(opts),
      '--null',
      '--line-number',
      '--column',
      '--no-heading',
      `--max-columns=${this.maxColumns}`,
      '--max-columns-preview',
      '-e',
      query,
      '--',
      '.',
    ];
  }

  /** 取代用「列出命中檔」argv（rg -l --null）。 */
  private listArgs(query: string, opts: SearchOpts): string[] {
    return [...this.baseFlags(opts), '-l', '--null', '-e', query, '--', '.'];
  }

  /**
   * 白名單最小 env（A1）：只帶執行 rg 必要變數，永不帶 RIPGREP_CONFIG_PATH / RIPGREP_*，
   * 杜絕半可信環境以 config 的 --pre 達成零點擊 RCE。
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const allow =
      process.platform === 'win32'
        ? ['SystemRoot', 'windir', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS']
        : ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'];
    const env: NodeJS.ProcessEnv = {};
    for (const k of allow) {
      const v = process.env[k];
      if (v !== undefined) env[k] = v;
    }
    return env;
  }

  /** 新 streaming 搜尋進場前，殺超出上限的舊 streaming（保留最新 maxConcurrent-1 個，A4）。 */
  private enforceCap(): void {
    const searches = [...this.active.entries()].filter(
      ([, a]) => a.kind === 'search' && !a.done && !a.cancelled,
    );
    const overflow = searches.length - (this.maxConcurrent - 1);
    for (let i = 0; i < overflow; i++) {
      const [id, a] = searches[i]; // Map 保插入序 → 由舊到新
      a.cancelled = true;
      this.cleanup(id, true);
    }
  }

  private cleanup(searchId: string, kill: boolean): void {
    const a = this.active.get(searchId);
    if (!a) return;
    if (a.flushTimer) {
      clearTimeout(a.flushTimer);
      a.flushTimer = null;
    }
    if (kill && a.child) this.killChild(a.child);
    a.child = null;
    this.active.delete(searchId); // child 'close'/'error' 之後查不到 → 不再 emit（A4）
  }

  private killChild(child: SearchChild): void {
    try {
      child.kill();
    } catch {
      /* 程序可能已自行結束 */
    }
  }

  private isCancelled(searchId: string): boolean {
    const a = this.active.get(searchId);
    return !a || a.cancelled || a.done;
  }

  private recordDuration(a: ActiveSearch): void {
    try {
      record('search:duration', performance.now() - a.startedAt);
    } catch {
      /* perf 量測失敗不致命 */
    }
  }
}

/**
 * 註冊 search:* handlers（取代 stub）。router.ts：
 *   registerSearchHandlers(ipcMain, services.workspaces)
 * webContents 首次發 search:run 時掛 'destroyed' → killByOwner（reload/關窗殺殘留 rg，A4）。
 */
export function registerSearchHandlers(ipc: IpcMain, workspaces: WorkspaceManager): SearchService {
  const svc = new SearchService(workspaces);
  const hooked = new WeakSet<WebContents>();

  ipc.handle('search:run', (e, req: InvokeReq<'search:run'>) => {
    const sender = e.sender;
    if (!hooked.has(sender)) {
      hooked.add(sender);
      sender.once('destroyed', () => svc.killByOwner(sender));
    }
    return svc.run(req, sender);
  });
  ipc.handle('search:cancel', (_e, req: InvokeReq<'search:cancel'>) => svc.cancel(req));

  return svc;
}
