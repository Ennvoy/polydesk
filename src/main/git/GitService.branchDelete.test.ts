import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService, type GitExecFn } from './GitService';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 30_000 }).toString().trim();
}

function setup(): { root: string; repo: string; wsId: string; service: GitService; manager: WorkspaceManager } {
  const root = mkdtempSync(join(tmpdir(), 'pd-branch-delete-'));
  const repo = join(root, 'repo');
  const userData = join(root, 'userData');
  mkdirSync(repo, { recursive: true });
  mkdirSync(userData, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Polydesk Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');

  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const manager = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  const added = manager.add({ path: repo });
  if (!('id' in added)) throw new Error('workspace add failed');
  return { root, repo, wsId: added.id, service: new GitService(manager), manager };
}

describe('GitService.branch 分支安全刪除', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('本地分支只使用 git branch -d 安全刪除', async () => {
    git(ctx.repo, 'branch', 'merged-topic');
    const calls: string[][] = [];
    const recordingExec: GitExecFn = (file, args, options, callback) => {
      calls.push([...args]);
      return execFile(file, args, options, callback);
    };

    expect(await new GitService(ctx.manager, recordingExec).branch(ctx.wsId, 'delete-local', 'merged-topic')).toEqual({ ok: true });
    expect(calls).toContainEqual(['branch', '-d', '--', 'merged-topic']);
    expect(calls.flat()).not.toContain('-D');
    expect(git(ctx.repo, 'branch', '--list', 'merged-topic')).toBe('');
  });

  it('拒絕刪除目前分支並回傳結構化原因', async () => {
    expect(await ctx.service.branch(ctx.wsId, 'delete-local', 'main')).toEqual({
      error: '無法刪除目前分支。',
      code: 'current',
    });
  });

  it('拒絕刪除由其他 worktree 簽出的分支並回傳路徑', async () => {
    const worktreePath = join(ctx.root, 'topic-worktree');
    git(ctx.repo, 'branch', 'worktree-topic');
    git(ctx.repo, 'worktree', 'add', worktreePath, 'worktree-topic');

    expect(await ctx.service.branch(ctx.wsId, 'delete-local', 'worktree-topic')).toEqual({
      error: `此分支正由 worktree 使用：${worktreePath}`,
      code: 'worktree',
      detail: worktreePath,
    });
  });

  it('未合併分支不提供強制刪除並回傳 unmerged', async () => {
    git(ctx.repo, 'checkout', '-b', 'unmerged-topic');
    writeFileSync(join(ctx.repo, 'topic.txt'), 'topic\n');
    git(ctx.repo, 'add', '.');
    git(ctx.repo, 'commit', '-m', 'topic');
    git(ctx.repo, 'checkout', 'main');

    const localizedExec: GitExecFn = (file, args, options, callback) =>
      execFile(file, args, options, (error, stdout, stderr) => {
        const isSafeDelete = args[0] === 'branch' && args[1] === '-d';
        callback(error, stdout, error && isSafeDelete ? Buffer.from('非英文的刪除失敗訊息') : stderr);
      });
    const result = await new GitService(ctx.manager, localizedExec).branch(ctx.wsId, 'delete-local', 'unmerged-topic');
    expect(result).toMatchObject({ code: 'unmerged' });
    expect(git(ctx.repo, 'branch', '--list', 'unmerged-topic')).toContain('unmerged-topic');
  });

  it('依 remote-tracking 名稱解析多 remote，且只 push-delete 指定遠端分支', async () => {
    const origin = join(ctx.root, 'origin.git');
    const backup = join(ctx.root, 'backup.git');
    mkdirSync(origin);
    mkdirSync(backup);
    git(origin, 'init', '--bare', '-b', 'main');
    git(backup, 'init', '--bare', '-b', 'main');
    git(ctx.repo, 'remote', 'add', 'origin', origin);
    git(ctx.repo, 'remote', 'add', 'backup', backup);
    git(ctx.repo, 'branch', 'feature/nested');
    git(ctx.repo, 'push', 'origin', 'feature/nested');
    git(ctx.repo, 'push', 'backup', 'feature/nested');

    expect(await ctx.service.branch(ctx.wsId, 'delete-remote', 'feature/nested', undefined, 'backup')).toEqual({ ok: true });
    expect(() => git(backup, 'show-ref', '--verify', 'refs/heads/feature/nested')).toThrow();
    expect(git(origin, 'show-ref', '--verify', 'refs/heads/feature/nested')).not.toBe('');
  }, 60_000);

  it('remote 名稱含斜線時回傳結構化身分並精確刪除', async () => {
    const teamBackend = join(ctx.root, 'team-backend.git');
    mkdirSync(teamBackend);
    git(teamBackend, 'init', '--bare', '-b', 'main');
    git(ctx.repo, 'remote', 'add', 'team/backend', teamBackend);
    git(ctx.repo, 'branch', 'release');
    git(ctx.repo, 'push', 'team/backend', 'release');

    const listed = await ctx.service.branch(ctx.wsId, 'list');
    if (!('branches' in listed)) throw new Error('expected list result');
    expect(listed.remoteBranches).toContainEqual({
      remote: 'team/backend',
      name: 'release',
      ref: 'team/backend/release',
    });

    expect(await ctx.service.branch(ctx.wsId, 'delete-remote', 'release', undefined, 'team/backend')).toEqual({ ok: true });
    expect(() => git(teamBackend, 'show-ref', '--verify', 'refs/heads/release')).toThrow();
    expect(git(ctx.repo, 'branch', '--list', 'release')).toContain('release');
  }, 60_000);

  it('非法本地／遠端 ref 皆回 invalid，且不會成為 Git argv', async () => {
    expect(await ctx.service.branch(ctx.wsId, 'delete-local', '-D')).toEqual({
      error: '無效的分支名稱。',
      code: 'invalid',
    });
    expect(await ctx.service.branch(ctx.wsId, 'delete-remote', 'main:refs/heads/evil', undefined, 'origin')).toEqual({
      error: '無效的遠端分支名稱。',
      code: 'invalid',
    });
  });
});
