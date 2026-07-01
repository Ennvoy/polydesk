// F-7 GitService 單元測試（真 git + 真 temp repo，無 mock）。
// 涵蓋 status/changes/stage→commit→歸零/log/branch list-create，以及紅軍 A1 整合（惡意分支名不進 argv）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService, type GitExecFn } from './GitService';

function initRepo(dir: string): void {
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Polydesk Test']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['config', 'core.autocrlf', 'false']);
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pd-git-'));
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

describe('GitService（真 git）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('非 repo 目錄 → status isRepo:false（REQ-MON-003）', async () => {
    const svc = new GitService(ctx.mgr);
    const st = await svc.status(ctx.wsId);
    expect(st.isRepo).toBe(false);
    expect(st.changedCount).toBe(0);
    expect(st.branch).toBeNull();
  });

  it('status 解析 branch / changedCount；無 upstream → ahead/behind null', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'a.txt'), 'hello');
    const svc = new GitService(ctx.mgr);
    const st = await svc.status(ctx.wsId);
    expect(st.isRepo).toBe(true);
    expect(st.branch).toBe('main');
    expect(st.detached).toBe(false);
    expect(st.changedCount).toBe(1);
    expect(st.ahead).toBeNull(); // 新 repo 無 upstream
    expect(st.behind).toBeNull();
  });

  it('changes 反映新檔（untracked → ?）', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'a.txt'), 'hello');
    const svc = new GitService(ctx.mgr);
    const ch = await svc.changes(ctx.wsId);
    expect(ch.some((c) => c.path === 'a.txt' && c.status === '?' && !c.staged)).toBe(true);
  });

  it('stage → commit → status changedCount 歸零，commit 回 hash', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'a.txt'), 'hello');
    const svc = new GitService(ctx.mgr);
    await svc.stage(ctx.wsId, ['a.txt'], true);
    const res = await svc.commit(ctx.wsId, 'init commit');
    expect('ok' in res).toBe(true);
    if ('ok' in res) expect(res.hash).toMatch(/^[0-9a-f]{7,40}$/);
    const st = await svc.status(ctx.wsId);
    expect(st.changedCount).toBe(0);
  });

  it('log 回 commit 紀錄；空 repo 回 []', async () => {
    initRepo(ctx.repo);
    const svc = new GitService(ctx.mgr);
    expect(await svc.log(ctx.wsId, 10)).toEqual([]);
    writeFileSync(join(ctx.repo, 'a.txt'), 'x');
    await svc.stage(ctx.wsId, ['a.txt'], true);
    await svc.commit(ctx.wsId, 'first');
    const log = await svc.log(ctx.wsId, 10);
    expect(log.length).toBe(1);
    expect(log[0].subject).toBe('first');
    expect(log[0].author).toBe('Polydesk Test');
    expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(log[0].date).toBeGreaterThan(0);
    expect(log[0].parents).toEqual([]); // root commit 無 parent（線圖用）

    // 第二個 commit → parents 指向第一個（%P 解析驗證）
    writeFileSync(join(ctx.repo, 'b.txt'), 'y');
    await svc.stage(ctx.wsId, ['b.txt'], true);
    await svc.commit(ctx.wsId, 'second');
    const log2 = await svc.log(ctx.wsId, 10);
    expect(log2.length).toBe(2);
    expect(log2[0].subject).toBe('second');
    expect(log2[0].parents).toEqual([log[0].hash]);
  });

  it('合法分支名可建立並出現在 list', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'a.txt'), 'x');
    const svc = new GitService(ctx.mgr);
    await svc.stage(ctx.wsId, ['a.txt'], true);
    await svc.commit(ctx.wsId, 'init');
    const created = await svc.branch(ctx.wsId, 'create', 'feature/x');
    expect(created).toEqual({ ok: true });
    const r = await svc.branch(ctx.wsId, 'list');
    if (!('branches' in r)) throw new Error('expected list result');
    expect(r.branches).toContain('feature/x');
    expect(r.branches).toContain('main');
    expect(r.current).toBe('main');
  });

  it('A1：惡意分支名 create/checkout 永不執行 git，且回明確 invalid 錯誤', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'a.txt'), 'x');
    const seed = new GitService(ctx.mgr);
    await seed.stage(ctx.wsId, ['a.txt'], true);
    await seed.commit(ctx.wsId, 'init');

    const calls: string[][] = [];
    const exec: GitExecFn = (file, args, options, cb) => {
      calls.push([...args]);
      return execFile(file, args, options, cb);
    };
    const svc = new GitService(ctx.mgr, exec);

    const evilNames = ['main:refs/heads/evil', '+main', '@{0}', '../x', 'x.lock', 'HEAD', '-D'];
    for (const bad of evilNames) {
      await expect(svc.branch(ctx.wsId, 'checkout', bad)).rejects.toThrow(/invalid/i);
      await expect(svc.branch(ctx.wsId, 'create', bad)).rejects.toThrow(/invalid/i);
    }
    // 注入字串永不進 argv（execFile 全程未被呼叫）
    expect(calls.length).toBe(0);

    // 對照：repo 歷史未被竄改（仍只有 1 個 commit、分支仍 main）
    const log = await seed.log(ctx.wsId, 10);
    expect(log.length).toBe(1);
  });

  it('discard：untracked 移到資源回收桶（不永久刪）、tracked 還原到 HEAD（codex #4 資料安全）', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'tracked.txt'), 'ORIGINAL\n');
    execFileSync('git', ['add', '.'], { cwd: ctx.repo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: ctx.repo, stdio: 'pipe' });
    writeFileSync(join(ctx.repo, 'tracked.txt'), 'MODIFIED\n'); // tracked 改動
    writeFileSync(join(ctx.repo, 'newfile.txt'), 'NEW\n'); // untracked 新檔

    const trashed: string[] = [];
    const svc = new GitService(ctx.mgr, undefined, async (p) => {
      trashed.push(p);
    });
    await svc.discard(ctx.wsId, ['tracked.txt', 'newfile.txt']);

    // tracked：checkout HEAD 還原（內容回 ORIGINAL、檔仍在）
    expect(readFileSync(join(ctx.repo, 'tracked.txt'), 'utf8')).toBe('ORIGINAL\n');
    // untracked：走 trash（絕對路徑）而非 git clean -fd 硬刪
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toContain('newfile.txt');
    expect(isAbsolute(trashed[0])).toBe(true);
    // 注入的 trash 沒真的刪 → 檔仍在（反證走的不是 clean -fd）
    expect(existsSync(join(ctx.repo, 'newfile.txt'))).toBe(true);
  });
});
