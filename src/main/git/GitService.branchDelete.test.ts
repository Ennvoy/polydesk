import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService } from './GitService';

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

describe('GitService.branch 舊直接刪除入口', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('本地分支直接刪除停用，分支保持存在', async () => {
    git(ctx.repo, 'branch', 'merged-topic');
    expect(await ctx.service.branch(ctx.wsId, 'delete-local', 'merged-topic')).toEqual({
      error: '直接刪除入口已停用；請使用具備 preview、lease 與 journal 的完整清理流程。',
      code: 'invalid',
    });
    expect(git(ctx.repo, 'branch', '--list', 'merged-topic')).toContain('merged-topic');
  });

  it('remote 名稱含斜線時仍可列出，但舊遠端刪除入口不送出 push', async () => {
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

    expect(await ctx.service.branch(ctx.wsId, 'delete-remote', 'release', undefined, 'team/backend')).toEqual({
      error: '直接刪除入口已停用；請使用具備 preview、lease 與 journal 的完整清理流程。',
      code: 'invalid',
    });
    expect(git(teamBackend, 'show-ref', '--verify', 'refs/heads/release')).not.toBe('');
    expect(git(ctx.repo, 'branch', '--list', 'release')).toContain('release');
  }, 60_000);

  it('非法本地／遠端 ref 也只回停用契約，不進入舊刪除解析', async () => {
    expect(await ctx.service.branch(ctx.wsId, 'delete-local', '-D')).toEqual({
      error: '直接刪除入口已停用；請使用具備 preview、lease 與 journal 的完整清理流程。',
      code: 'invalid',
    });
    expect(await ctx.service.branch(ctx.wsId, 'delete-remote', 'main:refs/heads/evil', undefined, 'origin')).toEqual({
      error: '直接刪除入口已停用；請使用具備 preview、lease 與 journal 的完整清理流程。',
      code: 'invalid',
    });
  });
});
