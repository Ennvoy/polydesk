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
import { shell, type IpcMain } from 'electron';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { GitStatus, GitChange, GitLogEntry, GitWorktree } from '../../shared/types';
import type { InvokeReq } from '../../shared/ipc';
import { GIT_LOCAL_TIMEOUT_MS, GIT_NETWORK_TIMEOUT_MS } from '../../shared/constants';
import {
  validateRef,
  readHardeningArgs,
  readEnv,
  writeEnv,
  networkEnv,
  withPathspecs,
} from './gitSafeArgs';
import { enqueue } from './gitSerialQueue';
import { buildSpawnEnv } from '../security/spawnEnv';
import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync, existsSync, rmSync } from 'node:fs';
import { join as pathJoin, resolve as pathResolve } from 'node:path';
import { validateWorktreeTarget } from './worktreePath';

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
/** 解析 `diff-tree --name-status -z` 的 NUL 分隔輸出（rename/copy 取新路徑）。 */
function parseNameStatusZ(out: string): { path: string; status: string }[] {
  const toks = out.split('\0').filter((t) => t.length > 0);
  const files: { path: string; status: string }[] = [];
  let i = 0;
  while (i < toks.length) {
    const status = toks[i++];
    if (status === undefined) break;
    const code = status[0] ?? '?';
    if ((code === 'R' || code === 'C') && i + 1 < toks.length) {
      i++; // 舊路徑（略）
      files.push({ path: toks[i++] ?? '', status: code }); // 新路徑
    } else {
      files.push({ path: toks[i++] ?? '', status: code });
    }
  }
  return files;
}

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
    // untracked discard 走系統資源回收桶（可注入供測試；預設 Electron shell.trashItem）。
    private readonly trash: (p: string) => Promise<void> = (p) => shell.trashItem(p),
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
      if (staged || stdout.trim().length > 0) return { patch: stdout };
      // 非 staged 且空 → 可能是 untracked 檔（git diff 不顯示未追蹤）→ 顯示「整檔新增」（like VSCode）。
      if (await this.isUntracked(cwd, path)) return { patch: await this.noIndexDiff(cwd, path) };
      return { patch: stdout };
    } catch (e) {
      if (isNotARepo(e)) return { patch: '' };
      throw e;
    }
  }

  /** 取整個 staged diff（git diff --cached），供 AI 產生 commit message。超 maxChars 截斷並附 --stat 摘要。 */
  async stagedDiff(wsId: string, maxChars: number): Promise<{ patch: string; truncated: boolean }> {
    const cwd = this.path(wsId);
    if (!cwd) return { patch: '', truncated: false };
    const base = [...readHardeningArgs(), 'diff', '--cached', '--no-color', '--no-textconv'];
    try {
      const { stdout } = await this.run(base, { cwd, env: readEnv() });
      if (stdout.length <= maxChars) return { patch: stdout, truncated: false };
      // 超量：截斷 patch + 附完整 --stat 摘要，讓 AI 仍知全貌。
      let stat = '';
      try {
        const r = await this.run([...readHardeningArgs(), 'diff', '--cached', '--stat'], { cwd, env: readEnv() });
        stat = r.stdout;
      } catch {
        /* stat 取不到：略過摘要 */
      }
      return { patch: `${stdout.slice(0, maxChars)}\n\n…（diff 已截斷，以下為完整檔案統計）…\n${stat}`, truncated: true };
    } catch (e) {
      if (isNotARepo(e)) return { patch: '', truncated: false };
      throw e;
    }
  }

  /** 該 path 是否未被 git 追蹤（ls-files --error-unmatch 退出非零＝untracked）。 */
  private async isUntracked(cwd: string, path: string): Promise<boolean> {
    try {
      await this.run(withPathspecs([...readHardeningArgs(), 'ls-files', '--error-unmatch'], [path]), {
        cwd,
        env: readEnv(),
      });
      return false;
    } catch {
      return true;
    }
  }

  /** untracked 檔的「整檔新增」diff（git diff --no-index 對比 /dev/null；有差異會 exit 1，從 stdout 取 patch）。 */
  private async noIndexDiff(cwd: string, path: string): Promise<string> {
    try {
      const { stdout } = await this.run(
        [...readHardeningArgs(), 'diff', '--no-index', '--no-color', '--no-textconv', '--', '/dev/null', path],
        { cwd, env: readEnv() },
      );
      return stdout;
    } catch (e) {
      if (e instanceof GitError) return e.stdout; // --no-index 有差異 exit 1，stdout 才是 patch 本體
      throw e;
    }
  }

  /** PE-2：取消變更（discard）——tracked 用 checkout HEAD 還原、untracked 移到系統資源回收桶（可救回，前端附確認）。 */
  async discard(wsId: string, paths: string[]): Promise<{ ok: true }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    if (paths.length === 0) return { ok: true };
    const tracked: string[] = [];
    const untracked: string[] = [];
    for (const p of paths) {
      if (await this.isUntracked(cwd, p)) untracked.push(p);
      else tracked.push(p);
    }
    if (tracked.length > 0) {
      // checkout HEAD -- <paths>：index + 工作樹都還原到 HEAD（徹底丟棄該檔變更）。
      await this.run(withPathspecs([...readHardeningArgs(), 'checkout', 'HEAD'], tracked), { cwd, env: writeEnv() });
    }
    if (untracked.length > 0) {
      // untracked＝從未被 git 追蹤的新檔，捨棄＝從工作區移除。改用系統資源回收桶（shell.trashItem）而非
      // git clean -fd 永久刪除——誤按「取消變更」仍可從回收桶救回（資料安全，取代不可復原的硬刪）。
      for (const p of untracked) {
        await this.trash(pathJoin(cwd, p));
      }
    }
    return { ok: true };
  }

  /** PE-2：將路徑加入工作區根 .gitignore（去重、各一行、確保結尾換行；非執行、純檔寫入）。 */
  async ignore(wsId: string, paths: string[]): Promise<{ ok: true }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    const giPath = pathJoin(cwd, '.gitignore');
    let existing = '';
    try {
      existing = await readFile(giPath, 'utf8');
    } catch {
      /* 無 .gitignore → 新建 */
    }
    const have = new Set(
      existing
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    );
    const toAdd = paths.map((p) => p.replace(/\\/g, '/')).filter((p) => p.length > 0 && !have.has(p));
    if (toAdd.length === 0) return { ok: true };
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(giPath, `${existing}${prefix}${toAdd.join('\n')}\n`, 'utf8');
    return { ok: true };
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
      await this.run(args, { cwd, env: networkEnv(), timeoutMs: GIT_NETWORK_TIMEOUT_MS });
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
    startPoint?: string,
  ): Promise<{ branches: string[]; current: string; remotes?: string[] } | { ok: true }> {
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
      // 遠端分支（REQ-WT-002 來源③；排除 origin/HEAD 符號指標）——供 worktree 建立來源選單。
      let remotes: string[] = [];
      try {
        const r = await this.run(
          [...readHardeningArgs(), 'for-each-ref', '--format=%(refname:short)', 'refs/remotes'],
          { cwd, env: readEnv() },
        );
        remotes = r.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !/\/HEAD$/.test(s));
      } catch {
        remotes = [];
      }
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
      return { branches, current, remotes };
    }

    // create / checkout：白名單驗證，未過＝注入嫌疑 → 永不進 argv
    if (!validateRef(name)) throw new Error('invalid branch name');
    const safe = name as string;
    if (op === 'create') {
      // 可選 startPoint（從某 commit/分支建立，PE-1「從此 commit 建分支」）；同樣 validateRef 擋注入。
      if (startPoint !== undefined) {
        if (!validateRef(startPoint)) throw new Error('invalid start point');
        await this.run(['branch', safe, startPoint as string], { cwd, env: writeEnv() });
      } else {
        await this.run(['branch', safe], { cwd, env: writeEnv() });
      }
    } else {
      await this.run(['checkout', safe], { cwd, env: writeEnv() });
    }
    return { ok: true };
  }

  /** PE-1：commit diff（git show <ref>；給 path 則限定單檔）。ref validateRef、path 走 literal pathspec、--no-textconv 防 RCE。 */
  async show(wsId: string, ref: string, path?: string): Promise<{ patch: string }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    if (!validateRef(ref)) throw new Error('invalid ref');
    // --format=：抑制 commit header，只留 diff（parseUnifiedDiff 反正跳過 header，但較乾淨）。
    const base = [...readHardeningArgs(), 'show', '--no-textconv', '--no-color', '--format=', ref as string];
    const args = path !== undefined ? withPathspecs(base, [path]) : base;
    const { stdout } = await this.run(args, { cwd, env: readEnv() });
    return { patch: stdout };
  }

  /** PE-1：某 commit 變更的檔案清單 + 狀態（點 commit 展開用；diff-tree -z 解析，空 repo/初始 commit 安全）。 */
  async commitFiles(wsId: string, ref: string): Promise<{ files: { path: string; status: string }[] }> {
    const cwd = this.path(wsId);
    if (!cwd) return { files: [] };
    if (!validateRef(ref)) throw new Error('invalid ref');
    try {
      const { stdout } = await this.run(
        [...readHardeningArgs(), 'diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '--root', ref as string],
        { cwd, env: readEnv() },
      );
      return { files: parseNameStatusZ(stdout) };
    } catch (e) {
      if (isNotARepo(e)) return { files: [] };
      throw e;
    }
  }

  /** REQ-SCM：歷史（NUL 分隔 record + unit-separator 欄位；空 repo 回 []）。 */
  async log(wsId: string, limit: number): Promise<GitLogEntry[]> {
    const cwd = this.path(wsId);
    if (!cwd) return [];
    const n = Math.max(1, Math.min(1000, Math.floor(limit) || 50));
    // 欄位以 unit-separator(\x1f) 分隔；%P=parents（空白分隔）；%s=subject、%b=body（hover 完整訊息用）放最後。
    const fmt = '%H%x1f%an%x1f%at%x1f%P%x1f%s%x1f%b';
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
          const [hash, author, at, parents, subject, body] = rec.split('\x1f');
          return {
            hash: hash ?? '',
            author: author ?? '',
            date: (parseInt(at ?? '0', 10) || 0) * 1000,
            subject: subject ?? '',
            parents: (parents ?? '').trim().split(/\s+/).filter((p) => p.length > 0),
            body: (body ?? '').trim(),
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

  // ─────────────── Git Worktree（REQ-WT，第二迭代）───────────────

  /** REQ-WT-008：列該 repo 全部 worktree（--porcelain -z 解析，特殊字元安全）。 */
  async worktreeList(wsId: string): Promise<GitWorktree[]> {
    const cwd = this.path(wsId);
    if (!cwd) return [];
    try {
      const { stdout } = await this.run([...readHardeningArgs(), 'worktree', 'list', '--porcelain', '-z'], {
        cwd,
        env: readEnv(),
      });
      return parseWorktreeList(stdout);
    } catch (e) {
      if (isNotARepo(e)) return [];
      throw e;
    }
  }

  /**
   * 解出主工作樹的 git-common-dir 絕對路徑（realpath，紅軍 A2 lineage 交叉驗證用）。
   * 回 null＝非 repo / 失敗。
   */
  async gitCommonDir(wsId: string): Promise<string | null> {
    const cwd = this.path(wsId);
    if (!cwd) return null;
    try {
      const { stdout } = await this.run(
        [...readHardeningArgs(), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd, env: readEnv() },
      );
      const p = stdout.split('\0')[0].trim() || stdout.trim();
      return p ? canonicalPath(p) : null;
    } catch {
      return null;
    }
  }

  /**
   * REQ-WT-002/010/015：建立 worktree。分支名經 validateRef（非法即 throw、永不執行 git）；
   * 路徑經 '--' 分隔（literal，選項終止）。kind：existing=既有分支、new=-b 新分支（可帶 base 起點）、
   * remote=先建本地追蹤分支（-b <name> --track <origin/name> 由呼叫端組 base）。
   * 失敗 throw GitError；半成品清理由 handler 層負責（見 registerWorktreeHandlers）。
   */
  async worktreeAdd(
    wsId: string,
    branch: { kind: 'existing' | 'new' | 'remote'; name: string; base?: string },
    targetPath: string,
  ): Promise<{ ok: true }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    if (!validateRef(branch.name)) throw new Error(`invalid branch name: ${branch.name}`);
    if (branch.base !== undefined && !validateRef(branch.base)) {
      throw new Error(`invalid base ref: ${branch.base}`);
    }
    const base = [...readHardeningArgs(), 'worktree', 'add'];
    // 路徑一律置於 '--' 之後（選項終止符），分支/起點續接其後。
    let tail: string[];
    if (branch.kind === 'existing') {
      tail = ['--', targetPath, branch.name];
    } else {
      // new / remote：-b 建新分支；base（起點或 origin/<name>）置尾。
      tail = ['-b', branch.name, '--', targetPath, ...(branch.base ? [branch.base] : [])];
    }
    await this.run([...base, ...tail], { cwd, env: writeEnv() });
    return { ok: true };
  }

  /** REQ-WT-006/007：移除 worktree（force 才帶 --force；路徑置 '--' 後）。teardown 由 handler 先做。 */
  async worktreeRemove(wsId: string, targetPath: string, force: boolean): Promise<{ ok: true }> {
    const cwd = this.path(wsId);
    if (!cwd) throw new Error('workspace not found');
    return this.worktreeRemoveByPath(targetPath, cwd, force);
  }

  /**
   * 由主工作樹 cwd 執行 remove（移除 handler 已先把該 worktree 工作區移出列表，
   * 故不能再靠其 wsId 取 cwd——改用主工作樹路徑當 cwd）。
   */
  async worktreeRemoveByPath(targetPath: string, mainCwd: string, force: boolean): Promise<{ ok: true }> {
    const args = [...readHardeningArgs(), 'worktree', 'remove', ...(force ? ['--force'] : []), '--', targetPath];
    await this.run(args, { cwd: mainCwd, env: writeEnv() });
    return { ok: true };
  }

  /** REQ-WT-009：清除失效登記。 */
  async worktreePrune(wsId: string): Promise<{ pruned: number }> {
    const cwd = this.path(wsId);
    if (!cwd) return { pruned: 0 };
    const { stdout } = await this.run([...readHardeningArgs(), 'worktree', 'prune', '-v'], {
      cwd,
      env: writeEnv(),
    });
    // -v 每 prune 一筆輸出一行；數行數當計數（無輸出＝0）。
    const pruned = stdout.split('\n').filter((l) => l.trim().length > 0).length;
    return { pruned };
  }
}

/** git-common-dir / 路徑正規化（realpath 後小寫化 on win32；解不了退 resolve）。紅軍 A2 lineage 用。 */
export function canonicalPath(p: string): string {
  let abs = pathResolve(p);
  try {
    abs = (realpathSync.native ?? realpathSync)(abs);
  } catch {
    /* 路徑不存在：用 lexical resolve */
  }
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * REQ-WT-003＋紅軍 A2：驗證候選 worktree 路徑確實隸屬指定主工作樹。
 * 比對「候選路徑解出的 git-common-dir」與「主工作樹解出的 git-common-dir」是否為同一實體
 * （皆 realpath 正規化）——git 自報的 worktree 登記路徑可被惡意 repo 竄改，故不可只信 list 輸出。
 */
export async function verifyWorktreeLineage(
  svc: GitService,
  candidateWsId: string,
  mainWsId: string,
): Promise<boolean> {
  const [cand, main] = await Promise.all([svc.gitCommonDir(candidateWsId), svc.gitCommonDir(mainWsId)]);
  if (!cand || !main) return false;
  return cand === main;
}

/** 解析 `git worktree list --porcelain -z`：NUL 分隔、空 record 分段；attributes 逐行。 */
export function parseWorktreeList(raw: string): GitWorktree[] {
  if (!raw) return [];
  const records: string[][] = [];
  let cur: string[] = [];
  for (const tok of raw.split('\0')) {
    if (tok === '') {
      if (cur.length) records.push(cur);
      cur = [];
      continue;
    }
    cur.push(tok);
  }
  if (cur.length) records.push(cur);

  const out: GitWorktree[] = [];
  records.forEach((rec, idx) => {
    let path = '';
    let head = '';
    let branch: string | null = null;
    let prunable = false;
    for (const line of rec) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length);
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (line === 'detached') branch = null;
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true;
    }
    if (path) out.push({ path, branch, head, isMain: idx === 0, prunable });
  });
  return out;
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
  ipc.handle('git:discard', (_e, req: InvokeReq<'git:discard'>) =>
    enqueue(req.wsId, () => svc.discard(req.wsId, req.paths)),
  );
  ipc.handle('git:ignore', (_e, req: InvokeReq<'git:ignore'>) =>
    enqueue(req.wsId, () => svc.ignore(req.wsId, req.paths)),
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
    enqueue(req.wsId, () => svc.branch(req.wsId, req.op, req.name, req.startPoint)),
  );
  ipc.handle('git:log', (_e, req: InvokeReq<'git:log'>) =>
    enqueue(req.wsId, () => svc.log(req.wsId, req.limit)),
  );
  ipc.handle('git:show', (_e, req: InvokeReq<'git:show'>) =>
    enqueue(req.wsId, () => svc.show(req.wsId, req.ref, req.path)),
  );
  ipc.handle('git:commitFiles', (_e, req: InvokeReq<'git:commitFiles'>) =>
    enqueue(req.wsId, () => svc.commitFiles(req.wsId, req.ref)),
  );
  ipc.handle('git:stash', (_e, req: InvokeReq<'git:stash'>) =>
    enqueue(req.wsId, () => svc.stash(req.wsId, req.op, req.includeUntracked)),
  );
  ipc.handle('git:init', (_e, req: InvokeReq<'git:init'>) =>
    enqueue(req.wsId, () => svc.init(req.wsId)),
  );

  // ── Git Worktree（REQ-WT）──
  // 佇列鍵一律用該 repo 的統一鍵（worktree 工作區解回主工作樹），避免 index.lock 交錯（紅軍 A5）。
  const qkey = (wsId: string): string => workspaces.queueKeyForRepo(wsId);

  ipc.handle('git:worktreeList', (_e, req: InvokeReq<'git:worktreeList'>) =>
    enqueue(qkey(req.wsId), async () => {
      try {
        const list = await svc.worktreeList(req.wsId);
        // 附 managedWsId：worktree 路徑已納管者標記，供 UI「切換到此」判斷。
        const all = workspaces.list();
        const withManaged = list.map((w) => {
          const norm = process.platform === 'win32' ? w.path.toLowerCase() : w.path;
          const hit = all.find((ws) => {
            const wp = process.platform === 'win32' ? ws.path.toLowerCase() : ws.path;
            return wp.replace(/[\\/]+$/, '') === norm.replace(/[\\/]+$/, '');
          });
          return hit ? { ...w, managedWsId: hit.id } : w;
        });
        return { list: withManaged };
      } catch (e) {
        return { error: errMsg(e, 'worktree list 失敗') };
      }
    }),
  );

  ipc.handle('git:worktreeAdd', (_e, req: InvokeReq<'git:worktreeAdd'>) =>
    enqueue(qkey(req.wsId), async () => {
      const target = validateWorktreeTarget(
        req.path,
        workspaces.list().map((w) => w.path),
      );
      if (!target.ok) return { error: `目標路徑不合法（${target.reason}）`, code: 'invalid-path' as const };
      const created = existsSync(target.abs);
      try {
        await svc.worktreeAdd(req.wsId, req.branch, target.abs);
      } catch (e) {
        // REQ-WT-010：半成品清理——僅刪「本次 git 建立的」目錄（呼叫前不存在、現在存在）。
        if (!created && existsSync(target.abs)) {
          try {
            rmSync(target.abs, { recursive: true, force: true });
          } catch {
            /* 清理失敗：不掩蓋原始 git 錯誤 */
          }
        }
        const msg = errMsg(e, 'worktree add 失敗');
        const code = /already (checked out|used by worktree)/i.test(msg)
          ? ('branch-taken' as const)
          : /already exists/i.test(msg)
            ? ('path-exists' as const)
            : /could not (read|fetch)|couldn't find remote|network|timed out/i.test(msg)
              ? ('net' as const)
              : undefined;
        return { error: msg, code };
      }
      // 成功：納管（主工作樹＝發起 repo；已納管→繼承信任）。
      const res = workspaces.addWorktree({ path: target.abs, mainPath: workspaces.get(req.wsId)?.path ?? req.path });
      if ('error' in res) return { error: `已建立 worktree 但納管失敗：${res.error}` };
      return { wsId: res.id };
    }),
  );

  ipc.handle('git:worktreePrune', (_e, req: InvokeReq<'git:worktreePrune'>) =>
    enqueue(qkey(req.wsId), async () => {
      try {
        return await svc.worktreePrune(req.wsId);
      } catch (e) {
        return { error: errMsg(e, 'worktree prune 失敗') };
      }
    }),
  );
  // git:worktreeRemove 需先 teardown（走 workspaces.remove → lifecycle）：同一 svc/workspaces 即可註冊。
  registerWorktreeRemoveHandler(ipc, workspaces, svc);
}

/**
 * REQ-WT-006/007＋紅軍 A5：移除 worktree handler（需 lifecycle → 在 router 層註冊，拿得到 teardown）。
 * 順序鐵則：先完整 teardown（等程序結束、handle 釋放）→ 再 git worktree remove（Windows 防 EBUSY）。
 * deleteFolder=false → 僅移出列表（保留資料夾）；true → git remove（dirty 由前端兩段確認後帶 force）。
 */
export function registerWorktreeRemoveHandler(
  ipc: IpcMain,
  workspaces: WorkspaceManager,
  svc: GitService,
): void {
  ipc.handle('git:worktreeRemove', async (_e, req: InvokeReq<'git:worktreeRemove'>) => {
    const ws = workspaces.get(req.wsId);
    if (!ws?.worktree) return { error: '非 worktree 工作區' };
    const target = ws.path;
    const mainKey = req.wsId;
    return enqueue(workspaces.queueKeyForRepo(mainKey), async () => {
      // 先 teardown（等程序結束、釋放檔案 handle）——不論是否刪資料夾都要收乾淨。
      await workspaces.remove(req.wsId, false);
      if (!req.deleteFolder) return { ok: true as const };
      try {
        await svc.worktreeRemoveByPath(target, ws.worktree!.mainPath, req.force);
        return { ok: true as const };
      } catch (e) {
        const msg = errMsg(e, 'worktree remove 失敗');
        const code = /is dirty|contains modified|use --force/i.test(msg)
          ? ('dirty' as const)
          : /unable to|EBUSY|being used|locked/i.test(msg)
            ? ('busy' as const)
            : undefined;
        return { error: msg, code };
      }
    });
  });
}
