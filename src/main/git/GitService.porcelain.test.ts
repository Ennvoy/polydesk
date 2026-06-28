// F-7 紅軍 A4：porcelain 解析錯位 + pathspec magic。
// 半可信 repo 故意建特殊字元檔名（空白 / 中文 / 空白）。若用 split('\n')/split(' ') 而非 -z(NUL)，
// path 會對不上磁碟，使用者「stage 檔 A」可能誤動檔 B。
// 防線：porcelain 一律 `-z` + quotePath=false；使用者 path 一律 literal pathspec（`:(literal)`）。
// 斷言：changes path 逐一對得上磁碟、數量正確；stage 只命中指定檔（magic 不生效）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService, type GitExecFn } from './GitService';

// Windows-legal 特殊檔名（: ? * 等在 Windows 為非法檔名，故以空白/unicode 覆蓋解析錯位面）
const SPECIAL = ['a b.txt', '中文.txt', 're name.txt'];

function initRepo(dir: string): void {
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Polydesk Test']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['config', 'core.autocrlf', 'false']);
  run(['config', 'core.quotePath', 'true']); // 故意開 quotePath：若實作沒覆寫就會 C-quote 錯位
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pd-gitpc-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  const added = mgr.add({ path: repo });
  if (!('id' in added)) throw new Error('workspace add failed');
  return { root, repo, mgr, wsId: added.id };
}

describe('GitService porcelain -z 解析（A4）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('changes 每個 path 對得上磁碟、數量正確（-z + quotePath=false）', async () => {
    initRepo(ctx.repo);
    for (const n of SPECIAL) writeFileSync(join(ctx.repo, n), 'x');

    const calls: string[][] = [];
    const exec: GitExecFn = (file, args, options, cb) => {
      calls.push([...args]);
      return execFile(file, args, options, cb);
    };
    const svc = new GitService(ctx.mgr, exec);
    const ch = await svc.changes(ctx.wsId);

    const paths = ch.map((c) => c.path).sort();
    expect(paths).toEqual([...SPECIAL].sort());
    for (const c of ch) {
      expect(existsSync(join(ctx.repo, c.path))).toBe(true);
    }

    const statusCall = calls.find((a) => a.includes('status'));
    expect(statusCall).toContain('-z');
    expect(statusCall).toContain('core.quotePath=false');
  });

  it('stage 以 literal pathspec 只命中指定檔（magic 不生效）', async () => {
    initRepo(ctx.repo);
    for (const n of SPECIAL) writeFileSync(join(ctx.repo, n), 'x');

    const calls: string[][] = [];
    const exec: GitExecFn = (file, args, options, cb) => {
      calls.push([...args]);
      return execFile(file, args, options, cb);
    };
    const svc = new GitService(ctx.mgr, exec);
    await svc.stage(ctx.wsId, ['a b.txt'], true);

    // argv 帶 -- 與 :(literal)<path>
    const addCall = calls.find((a) => a[0] === 'add');
    expect(addCall).toBeDefined();
    expect(addCall).toContain('--');
    expect(addCall).toContain(':(literal)a b.txt');

    // 只有該檔被 stage、其餘未動
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: ctx.repo,
      encoding: 'buffer',
    })
      .toString('utf8')
      .split('\0')
      .filter((s) => s.length > 0);
    expect(staged).toEqual(['a b.txt']);
  });
});
