import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, renameSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService, registerGitHandlers } from './GitService';
import type { IpcMain } from 'electron';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';

async function repository(check: (svc: GitService, dir: string, git: (...args: string[]) => string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pd-git-regression-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const workspaces = { get: () => ({ path: dir }) } as unknown as WorkspaceManager;
  const svc = new GitService(workspaces, undefined, async (path) => { rmSync(path); });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Polydesk Test');
    git('config', 'user.email', 'test@example.com');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'old.txt'), 'original\n');
    git('add', '.');
    git('commit', '-m', 'initial');
    await check(svc, dir, git);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('GitService 操作回歸（真 Git）', () => {
  it('取消重新命名的暫存時一併取消原路徑刪除', async () => repository(async (svc, dir, git) => {
    renameSync(join(dir, 'old.txt'), join(dir, 'new.txt'));
    git('add', '-A');
    await svc.stage('ws', ['new.txt'], false);
    expect(git('diff', '--cached', '--name-only').trim()).toBe('');
    expect(existsSync(join(dir, 'new.txt'))).toBe(true);
  }));

  it('捨棄已暫存的新檔時移到回收桶並清除 index', async () => repository(async (svc, dir, git) => {
    writeFileSync(join(dir, 'added.txt'), 'new\n');
    git('add', 'added.txt');
    await svc.discard('ws', ['added.txt']);
    expect(existsSync(join(dir, 'added.txt'))).toBe(false);
    expect(git('status', '--porcelain').trim()).toBe('');
  }));

  it('分支與 tag 同名時維持正確的分支身分', async () => repository(async (svc, _dir, git) => {
    git('tag', 'main');
    const result = await svc.branch('ws', 'list');
    expect(result).toMatchObject({ branches: ['main'], current: 'main' });
  }));

  it('merge commit 顯示相對第一個父節點的檔案變更', async () => repository(async (svc, dir, git) => {
    const root = git('rev-parse', 'HEAD').trim();
    expect(await svc.commitFiles('ws', root)).toEqual({ files: [{ path: 'old.txt', status: 'A' }] });
    git('checkout', '-b', 'feature');
    git('rm', 'old.txt');
    writeFileSync(join(dir, 'feature.txt'), 'feature');
    git('add', '.');
    git('commit', '-m', 'feature');
    git('checkout', 'main');
    git('merge', '--no-ff', 'feature', '-m', 'merge');
    const hash = git('rev-parse', 'HEAD').trim();
    expect(await svc.commitFiles('ws', hash)).toEqual({ files: [{ path: 'feature.txt', status: 'A' }, { path: 'old.txt', status: 'D' }] });
    expect((await svc.show('ws', hash, 'feature.txt')).patch).toContain('+feature');
    expect((await svc.show('ws', hash, 'old.txt')).patch).toContain('-original');
  }));

  it('GUI diff 不執行 repository 設定的外部 diff 程式', async () => repository(async (svc, dir, git) => {
    writeFileSync(join(dir, 'old.txt'), 'modified\n');
    writeFileSync(join(dir, 'helper.cjs'), 'require("fs").writeFileSync("external-marker", "executed")');
    git('config', 'diff.external', 'node helper.cjs');
    const result = await svc.diff('ws', 'old.txt', false);
    expect(existsSync(join(dir, 'external-marker'))).toBe(false);
    expect(result.patch).toContain('+modified');
    git('add', 'old.txt');
    expect((await svc.stagedDiff('ws', 10000)).patch).toContain('+modified');
    expect((await svc.stagedDiff('ws', 1)).truncated).toBe(true);
    git('commit', '-m', 'modified');
    expect((await svc.show('ws', git('rev-parse', 'HEAD').trim())).patch).toContain('+modified');
    writeFileSync(join(dir, 'untracked.txt'), 'untracked');
    expect((await svc.diff('ws', 'untracked.txt', false)).patch).toContain('+untracked');
    expect(existsSync(join(dir, 'external-marker'))).toBe(false);
  }));

  it('legacy linked worktree 與未納管主工作樹依實體 common-dir 共用佇列鍵', async () => repository(async (svc, dir, git) => {
    const linked = join(dir, 'linked');
    git('worktree', 'add', '-b', 'feature', linked);
    const workspaces = { get: (id: string) => ({ path: id === 'main' ? dir : linked }) } as unknown as WorkspaceManager;
    const linkedSvc = new GitService(workspaces);
    expect(await linkedSvc.repositoryQueueKey('legacy-linked')).toBe(await svc.repositoryQueueKey('ws'));
    expect(await linkedSvc.repositoryQueueKey('main')).toBe(await linkedSvc.repositoryQueueKey('legacy-linked'));
  }));

  it('捨棄重新命名會復原來源並移走新路徑', async () => repository(async (svc, dir, git) => {
    git('mv', 'old.txt', 'new.txt');
    await svc.discard('ws', ['new.txt']);
    expect(existsSync(join(dir, 'new.txt'))).toBe(false);
    expect(readFileSync(join(dir, 'old.txt'), 'utf8')).toBe('original\n');
    expect(git('status', '--porcelain').trim()).toBe('');
  }));

  it('越界、絕對與 Git metadata 路徑在捨棄或忽略前即拒絕', async () => repository(async (_svc, dir) => {
    let calls = 0;
    const mgr = { get: () => ({ path: dir }) } as unknown as WorkspaceManager;
    const svc = new GitService(mgr, undefined, async () => { calls += 1; });
    for (const invalid of ['../outside.txt', join(tmpdir(), 'outside.txt'), '.git', '.']) {
      await expect(svc.discard('ws', [invalid])).rejects.toThrow('outside-workspace');
      await expect(svc.ignore('ws', [invalid])).rejects.toThrow('outside-workspace');
    }
    expect(calls).toBe(0);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  }));

  it('含已追蹤檔案的目錄只還原 tracked 內容並保留 untracked 檔案', async () => repository(async (svc, dir, git) => {
    mkdirSync(join(dir, 'folder'));
    writeFileSync(join(dir, 'folder', 'tracked.txt'), 'original\n');
    git('add', 'folder');
    git('commit', '-m', 'folder');
    writeFileSync(join(dir, 'folder', 'tracked.txt'), 'modified\n');
    writeFileSync(join(dir, 'folder', 'untracked.txt'), 'preserved\n');
    await svc.discard('ws', ['folder/./']);
    expect(readFileSync(join(dir, 'folder', 'tracked.txt'), 'utf8')).toBe('original\n');
    expect(readFileSync(join(dir, 'folder', 'untracked.txt'), 'utf8')).toBe('preserved\n');
  }));

  it('history 讀到損壞 ref 時回報錯誤，不假裝 repository 沒有提交', async () => repository(async (svc, dir) => {
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'broken'), `${'a'.repeat(40)}\n`);
    await expect(svc.log('ws', 50)).rejects.toThrow('bad object');
    expect(readFileSync(join(dir, '.git', 'refs', 'heads', 'broken'), 'utf8')).toBe(`${'a'.repeat(40)}\n`);
  }));

  it('pull 衝突保留 stdout 的 CONFLICT 診斷與未解決狀態', async () => repository(async (svc, dir, git) => {
    git('checkout', '-b', 'feature');
    writeFileSync(join(dir, 'old.txt'), 'feature\n');
    git('commit', '-am', 'feature');
    git('checkout', 'main');
    writeFileSync(join(dir, 'old.txt'), 'main\n');
    git('commit', '-am', 'main');
    git('config', 'branch.main.remote', '.');
    git('config', 'branch.main.merge', 'refs/heads/feature');
    git('config', 'pull.rebase', 'false');
    const result = await svc.pull('ws');
    expect(result).toHaveProperty('error', expect.stringContaining('CONFLICT'));
    expect((await svc.changes('ws')).some((change) => change.status === 'U')).toBe(true);
  }));

  it('stash pop 衝突保留 CONFLICT 診斷與 stash', async () => repository(async (svc, dir, git) => {
    writeFileSync(join(dir, 'old.txt'), 'stashed\n');
    await svc.stash('ws', 'push');
    writeFileSync(join(dir, 'old.txt'), 'committed\n');
    git('commit', '-am', 'committed');
    await expect(svc.stash('ws', 'pop')).rejects.toThrow('CONFLICT');
    expect(git('stash', 'list').trim()).not.toBe('');
    expect((await svc.changes('ws')).some((change) => change.status === 'U')).toBe(true);
  }));

  it('registered commit 與 legacy linked-worktree branch handler 共用 repository 序列佇列', async () => repository(async (_svc, dir, git) => {
    const linked = join(dir, 'linked');
    git('worktree', 'add', '-b', 'feature', linked);
    const hooks = join(dir, 'hooks');
    mkdirSync(hooks);
    const marker = join(dir, 'commit-started');
    const release = join(dir, 'commit-release');
    const script = join(hooks, 'pause.cjs');
    writeFileSync(script, `const fs=require('fs');fs.writeFileSync(${JSON.stringify(marker)},'started');const until=Date.now()+20000;while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>until)process.exit(1);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}`);
    writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\nnode "${script.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    const linkedGit = (...args: string[]): string => execFileSync('git', args, { cwd: linked, encoding: 'utf8', stdio: 'pipe' });
    writeFileSync(join(linked, 'old.txt'), 'commit pending\n');
    linkedGit('add', 'old.txt');
    const mgr = { get: (id: string) => ({ path: id === 'main' ? dir : linked }) } as unknown as WorkspaceManager;
    type Handler = (event: unknown, request: unknown) => Promise<unknown>;
    const handlers = new Map<string, Handler>();
    const ipc = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); } } as unknown as IpcMain;
    let linkedReadyResolve!: () => void;
    const linkedReady = new Promise<void>((resolve) => { linkedReadyResolve = resolve; });
    const originalKey = GitService.prototype.repositoryQueueKey;
    const keySpy = vi.spyOn(GitService.prototype, 'repositoryQueueKey').mockImplementation(async function (this: GitService, id: string) {
      const key = await originalKey.call(this, id);
      if (id === 'main') linkedReadyResolve();
      return key;
    });
    registerGitHandlers(ipc, mgr, join(dir, 'userdata'));
    const commit = handlers.get('git:commit')!({}, { wsId: 'legacy-linked', message: 'serialized commit' });
    let branch: Promise<unknown> | undefined;
    try {
      const deadline = Date.now() + 15000;
      while (!existsSync(marker) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(existsSync(marker)).toBe(true);
      branch = handlers.get('git:branch')!({}, { wsId: 'main', op: 'create', name: 'queued-branch', startPoint: 'feature' });
      await linkedReady;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(existsSync(join(dir, '.git', 'refs', 'heads', 'queued-branch'))).toBe(false);
      writeFileSync(release, 'release');
      expect(await commit).toHaveProperty('ok', true);
      expect(await branch).toEqual({ ok: true });
      expect(git('for-each-ref', '--format=%(refname)', 'refs/heads/queued-branch').trim()).toBe('refs/heads/queued-branch');
      expect(git('rev-parse', 'queued-branch').trim()).toBe(linkedGit('rev-parse', 'HEAD').trim());
    } finally {
      writeFileSync(release, 'release');
      await Promise.allSettled([commit, ...(branch ? [branch] : [])]);
      keySpy.mockRestore();
    }
  }));

  it('同一真 repository 的歷史、分支與 worktree 讀取不等慢狀態掃描', async () => repository(async (_svc, dir) => {
    const mgr = { get: () => ({ path: dir }), list: () => [{ id: 'ws', path: dir }] } as unknown as WorkspaceManager;
    type Handler = (event: unknown, request: unknown) => Promise<unknown>;
    const handlers = new Map<string, Handler>();
    const ipc = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); } } as unknown as IpcMain;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const original = GitService.prototype.snapshot;
    const spy = vi.spyOn(GitService.prototype, 'snapshot').mockImplementation(async function (this: GitService, id: string) {
      const result = await original.call(this, id); // 實際 Git status 完成後保持 reader 佔位。
      started();
      await gate;
      return result;
    });
    let writerEntered = false;
    const originalBranch = GitService.prototype.branch;
    const branchSpy = vi.spyOn(GitService.prototype, 'branch').mockImplementation(async function (this: GitService, ...args: Parameters<GitService['branch']>) {
      if (args[1] === 'create') writerEntered = true;
      return originalBranch.apply(this, args);
    });
    let keyCallCount = 0;
    let writerKeyReady!: () => void;
    const writerKey = new Promise<void>((resolve) => { writerKeyReady = resolve; });
    const originalKey = GitService.prototype.repositoryQueueKey;
    const keySpy = vi.spyOn(GitService.prototype, 'repositoryQueueKey').mockImplementation(async function (this: GitService, id: string) {
      const ordinal = ++keyCallCount;
      const key = await originalKey.call(this, id);
      if (ordinal === 5) writerKeyReady();
      return key;
    });
    registerGitHandlers(ipc, mgr, join(dir, 'userdata'));
    const snapshot = handlers.get('git:snapshot')!({}, { wsId: 'ws' });
    let requests: Promise<unknown[]> | undefined;
    let writer: Promise<unknown> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await entered;
      requests = Promise.all([
        handlers.get('git:logPage')!({}, { wsId: 'ws', offset: 0, limit: 20 }),
        handlers.get('git:branch')!({}, { wsId: 'ws', op: 'list' }),
        handlers.get('git:worktreeList')!({}, { wsId: 'ws' }),
      ]);
      const results = await Promise.race([
        requests,
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('metadata blocked by snapshot')), 15_000); }),
      ]);
      expect(results[0]).toMatchObject({ ok: true, entries: [{ subject: 'initial' }], hasMore: false });
      expect(results[1]).toHaveProperty('branches', ['main']);
      expect(results[2]).toHaveProperty('list');
      writer = handlers.get('git:branch')!({}, { wsId: 'ws', op: 'create', name: 'after-snapshot' });
      await writerKey;
      await Promise.resolve();
      expect(writerEntered).toBe(false);
      release();
      await expect(writer).resolves.toEqual({ ok: true });
      expect(writerEntered).toBe(true);
      expect(existsSync(join(dir, '.git', 'refs', 'heads', 'after-snapshot'))).toBe(true);
    } finally {
      if (timeout) clearTimeout(timeout);
      release();
      await Promise.allSettled([snapshot, ...(requests ? [requests] : []), ...(writer ? [writer] : [])]);
      spy.mockRestore();
      branchSpy.mockRestore();
      keySpy.mockRestore();
    }
  }));
});
