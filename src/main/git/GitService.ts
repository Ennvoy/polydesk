// git GUI 後端服務（F-7：REQ-SCM-001~009、REQ-MON-003）。
// 安全硬化要點（紅軍 A1~A4）：
// - 一律 execFile（shell:false）、argv 陣列、cwd=工作區 path；使用者輸入永不拼進 shell。
// - read 類每次帶 readHardeningArgs()（禁 fsmonitor/hooks/pager + quotePath=false）+ readEnv()
//   （NOSYSTEM/GLOBAL=devnull/OPTIONAL_LOCKS=0）；diff 另帶 --no-textconv → 惡意 .git/config 無法 RCE。
// - porcelain 一律 `-z`（NUL 分隔）解析，含特殊字元檔名不錯位（A4）。
// - commit message 走 `-F -`（stdin），完全不落地暫存檔（杜絕 A3：可預測路徑竄改 / symlink 任意覆寫 / 殘留）。
// - 分支/checkout 名先 validateRef，未過則「永不執行 git」並 throw invalid（A1：注入字串不進 argv）。
// - push/pull 不接受使用者 refspec（程式組 `git push`），逾時/失敗回明確 error（不假裝成功，REQ-SCM-007）。
// 序列化由 registerGitHandlers 經 gitSerialQueue 包覆（每工作區序列，REQ-SCM-008）。

import {
  execFile as nodeExecFile,
  type ChildProcess,
  type ExecFileException,
  type ExecFileOptionsWithBufferEncoding,
} from 'node:child_process';
import type { IpcMain } from 'electron';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { GitStatus, GitChange, GitLogEntry } from '../../shared/types';
import type { InvokeReq } from '../../shared/ipc';
import { GIT_LOCAL_TIMEOUT_MS, GIT_NETWORK_TIMEOUT_MS } from '../../shared/constants';
import {
  validateRef,
  readHardeningArgs,
  readEnv,
  writeEnv,
  withPathspecs,
} from './gitSafeArgs';
import { enqueue } from './gitSerialQueue';
import { buildSpawnEnv } from '../security/spawnEnv';

const GIT_BIN = 'git';
const MAX_BUFFER = 64 * 1024 * 1024;

/** 可注入的 execFile（buffer 編碼）——預設真 child_process，測試可注入 spy 包真 git。 */
export type GitExecFn = (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithBufferEncoding,
  callback: (error: ExecFileException | null, stdout: Buffer, stderr: Buffer) => void,
) => ChildProcess;

const defaultExecFile: GitExecFn = (file, args, options, callback) =>
  nodeExecFile(file, args, options, callback);

/** git 程序非零退出 / 逾時的型別化錯誤（呼叫端據此回 {error} 或判 not-a-repo）。 */
export class GitError extends Error {
  constructor(
    readonly code: number | null,
    readonly stderr: string,
    readonly stdout: string,
    readonly timedOut: boolean,
  ) {
    super(stderr || stdout || `git 退出碼 ${code ?? 'null'}`);
    this.name = 'GitError';
  }
}

interface RunOpts {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** 寫入 child.stdin（commit -F - 用）。 */
  input?: string;
  timeoutMs?: number;
}

function toStr(b: Buffer | string | undefined): string {
  if (b === undefined) return '';
  return Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
}

function isNotARepo(e: unknown): boolean {
  return e instanceof GitError && e.code === 128 && /not a git repository/i.test(e.stderr);
}

const NOT_REPO: GitStatus = {
  isRepo: false,
  branch: null,
  ahead: null,
  behind: null,
  changedCount: 0,
  detached: false,
};

/** porcelain v2 status code → GitChange.status。 */
function mapCode(c: string): GitChange['status'] {
  switch (c) {
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
    case 'C':
      return 'R';
    case 'U':
      return 'U';
    case 'M':
    case 'T':
    default:
      return 'M';
  }
}

/** 取 porcelain v2 一行第 n 個空白後的剩餘字串（path 為最後欄、可含空白，故不可用 split）。 */
function fieldAfter(line: string, spaceCount: number): string {
  let idx = 0;
  for (let n = 0; n < spaceCount; n++) {
    idx = line.indexOf(' ', idx);
    if (idx === -1) return '';
    idx += 1;
  }
  return line.slice(idx);
}

function pushXY(changes: GitChange[], xy: string, path: string): void {
  const x = xy[0];
  const y = xy[1];
  if (x && x !== '.') changes.push({ path, status: mapCode(x), staged: true });
  if (y && y !== '.') changes.push({ path, status: mapCode(y), staged: false });
}

/**
 * 解析 `git status --porcelain=v2 --branch -z` 輸出（NUL 分隔，含特殊字元檔名安全，A4）。
 * 回傳 GitStatus（branch/ahead/behind/changedCount/detached）與 GitChange[]（staged/unstaged 各一筆）。
 */
export function parseStatus(stdout: string): { status: GitStatus; changes: GitChange[] } {
  const tokens = stdout.split('\0');
  let branch: string | null = null;
  let detached = false;
  let ahead: number | null = null;
  let behind: number | null = null;
  const changes: GitChange[] = [];
  let changedFiles = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '') continue;

    if (t.startsWith('# ')) {
      const body = t.slice(2);
      if (body.startsWith('branch.head ')) {
        const h = body.slice('branch.head '.length);
        if (h === '(detached)') {
          detached = true;
          branch = null;
        } else {
          branch = h;
        }
      } else if (body.startsWith('branch.ab ')) {
        const parts = body.slice('branch.ab '.length).trim().split(/\s+/);
        const a = parts.find((p) => p.startsWith('+'));
        const b = parts.find((p) => p.startsWith('-'));
        ahead = a ? Math.abs(parseInt(a, 10)) || 0 : 0;
        behind = b ? Math.abs(parseInt(b, 10)) || 0 : 0;
      }
      continue;
    }

    const kind = t[0];
    if (kind === '1') {
      changedFiles += 1;
      pushXY(changes, t.slice(2, 4), fieldAfter(t, 8));
    } else if (kind === '2') {
      changedFiles += 1;
      pushXY(changes, t.slice(2, 4), fieldAfter(t, 9));
      i += 1; // 下一個 NUL 欄是 origPath，消費掉不當新紀錄
    } else if (kind === 'u') {
      changedFiles += 1;
      changes.push({ path: fieldAfter(t, 10), status: 'U', staged: false });
    } else if (kind === '?') {
      changedFiles += 1;
      changes.push({ path: t.slice(2), status: '?', staged: false });
    }
    // '!' ignored → 略過
  }

  return {
    status: { isRepo: true, branch, ahead, behind, changedCount: changedFiles, detached },
    changes,
  };
}

const STATUS_ARGS = [...readHardeningArgs(), 'status', '--porcelain=v2', '--branch', '-z'];

export class GitService {
  constructor(
    private readonly workspaces: WorkspaceManager,
    private readonly exec: GitExecFn = defaultExecFile,
  ) {}

  private path(wsId: string): string | undefined {
    return this.workspaces.get(wsId)?.path;
  }

  private run(args: string[], opts: RunOpts): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const options: ExecFileOptionsWithBufferEncoding = {
        cwd: opts.cwd,
        // REQ-SEC-002：白名單最小 env（不漏繼承的 GIT_EXTERNAL_DIFF/GIT_SSH_COMMAND/GIT_ASKPASS/
        // GIT_CONFIG_*/機密——其中 GIT_EXTERNAL_DIFF 在 diff 可達 RCE），再疊 readEnv/writeEnv 的 GIT_* 硬化。
        env: { ...buildSpawnEnv(), ...(opts.env ?? {}) },
        timeout: opts.timeoutMs ?? GIT_LOCAL_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        encoding: 'buffer',
      };
      const child = this.exec(GIT_BIN, args, options, (err, stdout, stderr) => {
        const out = toStr(stdout);
        const errOut = toStr(stderr);
        if (err) {
          const e = err as ExecFileException & { killed?: boolean };
          const timedOut = e.killed === true || e.signal === 'SIGTERM';
          const code = typeof e.code === 'number' ? e.code : null;
          reject(new GitError(code, errOut, out, timedOut));
          return;
        }
        resolve({ stdout: out, stderr: errOut });
      });
      if (opts.input !== undefined) {
        child.stdin?.end(opts.input);
      }
    });
  }

  /** REQ-SCM-001 / REQ-MON-003：分支/變更數/ahead-behind（無 .git→isRepo:false；無 upstream→null）。 */
  async status(wsId: string): Promise<GitStatus> {
    const cwd = this.path(wsId);
    if (!cwd) return NOT_REPO;
    try {
      const { stdout } = await this.run([...STATUS_ARGS], { cwd, env: readEnv() });
      return parseStatus(stdout).status;
    } catch (e) {
      if (isNotARepo(e)) return NOT_REPO;
      throw e;
    }
  }

  /** REQ-SCM-002：變更清單（porcelain -z，特殊字元檔名安全）。 */
  async changes(wsId: string): Promise<GitChange[]> {
    const cwd = this.path(wsId);
    if (!cwd) return [];
    try {
      const { stdout } = await this.run([...STATUS_ARGS], { cwd, env: readEnv() });
      return parseStatus(stdout).changes;
    } catch (e) {
      if (isNotARepo(e)) return [];
      throw e;
    }
  }

  /** REQ-SCM-003：單檔 diff（--no-textconv 防 textconv RCE；literal pathspec 防 magic）。 */
  async diff(wsId: string, path: string, staged: boolean): Promise<{ patch: string }> {
    const cwd = this.path(wsId);
    if (!cwd) return { patch: '' };
    const base = [
      ...readHardeningArgs(),
      'diff',
      '--no-color',
      '--no-textconv',
      ...(staged ? ['--cached'] : []),
    ];
    try {
      const { stdout } = await this.run(withPathspecs(base, [path]), { cwd, env: readEnv() });
      return { patch: stdout };
    } catch (e) {
      if (isNotARepo(e)) return { patch: '' };
      throw e;
    }
  }

  /** REQ-SCM-004：stage / unstage（literal pathspec；add 不觸發 hook）。 */
  async stage(wsId: string, paths: string[], staged: boolean): Promise<{ ok: true }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    if (paths.length === 0) return { ok: true };
    const base = staged ? ['add'] : ['reset', '--quiet'];
    await this.run(withPathspecs(base, paths), { cwd, env: writeEnv() });
    return { ok: true };
  }

  /** REQ-SCM-005：commit（訊息走 stdin -F -，零暫存檔落地，A3）。 */
  async commit(wsId: string, message: string): Promise<{ ok: true; hash: string } | { error: string }> {
    const cwd = this.path(wsId);
    if (!cwd) return { error: 'workspace not found' };
    try {
      await this.run(['commit', '-F', '-'], { cwd, env: writeEnv(), input: message });
      const { stdout } = await this.run([...readHardeningArgs(), 'rev-parse', 'HEAD'], {
        cwd,
        env: readEnv(),
      });
      return { ok: true, hash: stdout.trim() };
    } catch (e) {
      return { error: errMsg(e, 'commit 失敗') };
    }
  }

  /** REQ-SCM-007：push（程式組、無使用者 refspec；逾時/失敗回明確 error）。 */
  async push(wsId: string): Promise<{ ok: true } | { error: string }> {
    return this.network(wsId, ['push'], '推送');
  }

  /** REQ-SCM-007：pull。 */
  async pull(wsId: string): Promise<{ ok: true } | { error: string }> {
    return this.network(wsId, ['pull'], '拉取');
  }

  private async network(
    wsId: string,
    args: string[],
    label: string,
  ): Promise<{ ok: true } | { error: string }> {
    const cwd = this.path(wsId);
    if (!cwd) return { error: 'workspace not found' };
    try {
      await this.run(args, { cwd, env: writeEnv(), timeoutMs: GIT_NETWORK_TIMEOUT_MS });
      return { ok: true };
    } catch (e) {
      if (e instanceof GitError && e.timedOut) return { error: `${label}逾時` };
      return { error: errMsg(e, `${label}失敗`) };
    }
  }

  /** REQ-SCM-009：branch list/create/checkout（create/checkout 名先 validateRef，未過永不執行 git）。 */
  async branch(
    wsId: string,
    op: 'list' | 'create' | 'checkout',
    name?: string,
  ): Promise<{ branches: string[]; current: string } | { ok: true }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');

    if (op === 'list') {
      const { stdout } = await this.run(
        [...readHardeningArgs(), 'for-each-ref', '--format=%(refname:short)', 'refs/heads'],
        { cwd, env: readEnv() },
      );
      const branches = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      let current = '';
      try {
        const r = await this.run([...readHardeningArgs(), 'rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd,
          env: readEnv(),
        });
        current = r.stdout.trim();
        if (current === 'HEAD') current = ''; // detached
      } catch {
        current = '';
      }
      return { branches, current };
    }

    // create / checkout：白名單驗證，未過＝注入嫌疑 → 永不進 argv
    if (!validateRef(name)) throw new Error('invalid branch name');
    const safe = name as string;
    if (op === 'create') {
      await this.run(['branch', safe], { cwd, env: writeEnv() });
    } else {
      await this.run(['checkout', safe], { cwd, env: writeEnv() });
    }
    return { ok: true };
  }

  /** REQ-SCM：歷史（NUL 分隔 record + unit-separator 欄位；空 repo 回 []）。 */
  async log(wsId: string, limit: number): Promise<GitLogEntry[]> {
    const cwd = this.path(wsId);
    if (!cwd) return [];
    const n = Math.max(1, Math.min(1000, Math.floor(limit) || 50));
    // 欄位以 unit-separator(\x1f) 分隔；%P=parents（空白分隔），放 subject 之前（subject 可能含任意字元、留最後）。
    const fmt = '%H%x1f%an%x1f%at%x1f%P%x1f%s';
    try {
      const { stdout } = await this.run(
        // --topo-order：保證任何父都不早於其子出現（rebase/cherry-pick/時鐘偏移下，預設 date order 會讓
        // 父排在子前，破壞線圖 swimlane「子先於父」前提 → 畫出 dangling 錯誤線）。
        [...readHardeningArgs(), 'log', '--topo-order', '-n', String(n), `--pretty=format:${fmt}`, '-z'],
        { cwd, env: readEnv() },
      );
      return stdout
        .split('\0')
        .filter((r) => r.length > 0)
        .map((rec) => {
          const [hash, author, at, parents, subject] = rec.split('\x1f');
          return {
            hash: hash ?? '',
            author: author ?? '',
            date: (parseInt(at ?? '0', 10) || 0) * 1000,
            subject: subject ?? '',
            parents: (parents ?? '').trim().split(/\s+/).filter((p) => p.length > 0),
          };
        });
    } catch (e) {
      if (isNotARepo(e)) return [];
      if (e instanceof GitError && e.code === 128) return []; // 空 repo（無 commit）
      throw e;
    }
  }

  /** REQ-SCM：stash push/pop/list。push 可選 -u（含 untracked，供「切換分支前清乾淨工作樹」用）。 */
  async stash(wsId: string, op: 'push' | 'pop' | 'list', includeUntracked = false): Promise<unknown> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    if (op === 'list') {
      const { stdout } = await this.run([...readHardeningArgs(), 'stash', 'list', '-z'], {
        cwd,
        env: readEnv(),
      });
      return { entries: stdout.split('\0').filter((s) => s.length > 0) };
    }
    const args = op === 'push' && includeUntracked ? ['stash', 'push', '-u'] : ['stash', op];
    await this.run(args, { cwd, env: writeEnv() });
    return { ok: true };
  }

  /** REQ-SCM-006：git init。 */
  async init(wsId: string): Promise<{ ok: true }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    await this.run(['init'], { cwd, env: writeEnv() });
    return { ok: true };
  }
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof GitError) return e.stderr.trim() || e.stdout.trim() || fallback;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

/**
 * 註冊 git:* handlers（取代 stub）。全部經 gitSerialQueue.enqueue(wsId,...) 每工作區序列化（REQ-SCM-008）。
 * router.ts：registerGitHandlers(ipcMain, services.workspaces)。
 */
export function registerGitHandlers(ipc: IpcMain, workspaces: WorkspaceManager): void {
  const svc = new GitService(workspaces);

  ipc.handle('git:status', (_e, req: InvokeReq<'git:status'>) =>
    enqueue(req.wsId, () => svc.status(req.wsId)),
  );
  ipc.handle('git:changes', (_e, req: InvokeReq<'git:changes'>) =>
    enqueue(req.wsId, () => svc.changes(req.wsId)),
  );
  ipc.handle('git:diff', (_e, req: InvokeReq<'git:diff'>) =>
    enqueue(req.wsId, () => svc.diff(req.wsId, req.path, req.staged)),
  );
  ipc.handle('git:stage', (_e, req: InvokeReq<'git:stage'>) =>
    enqueue(req.wsId, () => svc.stage(req.wsId, req.paths, req.staged)),
  );
  ipc.handle('git:commit', (_e, req: InvokeReq<'git:commit'>) =>
    enqueue(req.wsId, () => svc.commit(req.wsId, req.message)),
  );
  ipc.handle('git:push', (_e, req: InvokeReq<'git:push'>) =>
    enqueue(req.wsId, () => svc.push(req.wsId)),
  );
  ipc.handle('git:pull', (_e, req: InvokeReq<'git:pull'>) =>
    enqueue(req.wsId, () => svc.pull(req.wsId)),
  );
  ipc.handle('git:branch', (_e, req: InvokeReq<'git:branch'>) =>
    enqueue(req.wsId, () => svc.branch(req.wsId, req.op, req.name)),
  );
  ipc.handle('git:log', (_e, req: InvokeReq<'git:log'>) =>
    enqueue(req.wsId, () => svc.log(req.wsId, req.limit)),
  );
  ipc.handle('git:stash', (_e, req: InvokeReq<'git:stash'>) =>
    enqueue(req.wsId, () => svc.stash(req.wsId, req.op, req.includeUntracked)),
  );
  ipc.handle('git:init', (_e, req: InvokeReq<'git:init'>) =>
    enqueue(req.wsId, () => svc.init(req.wsId)),
  );
}
