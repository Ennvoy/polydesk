import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateStore } from '../../../store/StateStore';
import { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../../../workspace/workspaceLifecycle';
import { CleanupService } from '../core/CleanupService';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 30_000 }).toString('utf8').trim();
}

function gitFails(cwd: string, ...args: string[]): boolean {
  try {
    git(cwd, ...args);
    return false;
  } catch {
    return true;
  }
}

describe('本機完整清理真 Git 鏈路', () => {
  let root: string;
  let repo: string;
  let userData: string;
  let workspaces: WorkspaceManager;
  let wsId: string;
  let service: CleanupService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-local-cleanup-'));
    repo = join(root, 'repo');
    userData = join(root, 'userData');
    mkdirSync(repo, { recursive: true });
    mkdirSync(userData, { recursive: true });
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Polydesk Test');
    git(repo, 'config', 'core.autocrlf', 'false');
    git(repo, 'config', 'core.logAllRefUpdates', 'true');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'base');
    const store = new StateStore(join(userData, 'state.json'));
    store.load();
    workspaces = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
    const workspace = workspaces.add({ path: repo });
    if (!('id' in workspace)) throw new Error('workspace setup failed');
    wsId = workspace.id;
    service = new CleanupService(workspaces, userData);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function execute(branch: string, options?: { force?: boolean; switchTo?: string; deleteBranch?: boolean; worktrees?: { id: string; mode: 'list-only' | 'delete-folder' | 'full-cleanup' | 'stale-registration'; unlock?: boolean }[]; acceptRisk?: boolean }) {
    const preview = await service.preview({
      wsId,
      branch,
      switchTo: options?.switchTo,
      removeWorktreeIds: options?.worktrees?.filter((worktree) => worktree.mode !== 'list-only').map((worktree) => worktree.id),
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error);
    const result = await service.execute({
      wsId,
      branch,
      leaseToken: preview.leaseToken,
      localPlan: { deleteBranch: options?.deleteBranch, switchTo: options?.switchTo, worktrees: options?.worktrees ?? [] },
      confirmation: {
        forceLocal: options?.force ?? false,
        acceptExternalWriteRisk: options?.acceptRisk ?? false,
        remoteTargets: [],
      },
    });
    return { preview, result };
  }

  it('安全刪除已合併分支並清除 local ref、branch config 與 reflog', async () => {
    git(repo, 'branch', 'profile');
    git(repo, 'config', 'branch.profile.description', 'temporary');
    expect(git(repo, 'reflog', 'exists', 'refs/heads/profile')).toBe('');

    const { result } = await execute('profile');

    expect(result).toMatchObject({ ok: true, phase: 'closed' });
    expect(gitFails(repo, 'show-ref', '--verify', 'refs/heads/profile')).toBe(true);
    expect(gitFails(repo, 'config', '--get-regexp', '^branch\\.profile\\.')).toBe(true);
    expect(gitFails(repo, 'reflog', 'exists', 'refs/heads/profile')).toBe(true);
    expect(service.status().journals).toEqual([]);
  }, 180_000);

  it('未合併分支先回 force-required，明確 force 後才刪除並回報不可達 commit 數', async () => {
    git(repo, 'checkout', '-b', 'profile');
    writeFileSync(join(repo, 'profile.txt'), 'only profile\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'profile only');
    git(repo, 'checkout', 'main');

    const first = await execute('profile');
    expect(first.preview.snapshot.localRisk).toEqual({ safeDelete: false, lostCommitCount: 1, exact: true });
    expect(first.result).toMatchObject({ ok: false, code: 'force-required' });
    expect(git(repo, 'rev-parse', 'profile')).toMatch(/^[0-9a-f]{40,64}$/);
    expect(service.status().journals).toEqual([]);

    const forced = await execute('profile', { force: true });
    if (!forced.result.ok) throw new Error(JSON.stringify(forced.result));
    expect(forced.result).toMatchObject({ ok: true, phase: 'closed' });
    expect(gitFails(repo, 'show-ref', '--verify', 'refs/heads/profile')).toBe(true);
  }, 240_000);

  it('目前主工作樹分支只有乾淨且切換候選仍可用時才切換，主資料夾保留', async () => {
    git(repo, 'branch', 'keep');

    const { result } = await execute('main', { switchTo: 'keep' });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ ok: true, phase: 'closed' });
    expect(git(repo, 'branch', '--show-current')).toBe('keep');
    expect(existsSync(repo)).toBe(true);
    expect(gitFails(repo, 'show-ref', '--verify', 'refs/heads/main')).toBe(true);
  }, 180_000);

  it('目前主工作樹 dirty 時不切換、不自動 stash，也不建立 mutating 結果', async () => {
    git(repo, 'branch', 'keep');
    writeFileSync(join(repo, 'dirty.txt'), 'dirty\n');

    const { result } = await execute('main', { switchTo: 'keep' });

    expect(result).toMatchObject({ ok: false, code: 'worktree-dirty' });
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'stash', 'list')).toBe('');
  }, 180_000);

  it('完整清理 linked worktree 會 teardown、刪資料夾、Git 登記與本地分支', async () => {
    const linked = join(root, 'profile-worktree');
    git(repo, 'branch', 'profile');
    git(repo, 'worktree', 'add', linked, 'profile');
    const managed = workspaces.addWorktree({ path: linked, mainPath: repo });
    if (!('id' in managed)) throw new Error('worktree setup failed');
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const target = preview.snapshot.worktrees.find((worktree) => worktree.branch === 'profile');
    if (!target) throw new Error('missing target worktree');
    const planned = await service.preview({ wsId, branch: 'profile', removeWorktreeIds: [target.id] });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const result = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: planned.leaseToken,
      localPlan: { worktrees: [{ id: target.id, mode: 'full-cleanup' }] },
      confirmation: { forceLocal: false, acceptExternalWriteRisk: true, remoteTargets: [] },
    });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ ok: true, phase: 'closed' });
    expect(existsSync(linked)).toBe(false);
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(linked);
    expect(workspaces.get(managed.id)).toBeUndefined();
    expect(gitFails(repo, 'show-ref', '--verify', 'refs/heads/profile')).toBe(true);
  }, 240_000);

  it('僅移出列表會留下資料夾、Git 登記與本地分支', async () => {
    const linked = join(root, 'profile-worktree');
    git(repo, 'branch', 'profile');
    git(repo, 'worktree', 'add', linked, 'profile');
    const managed = workspaces.addWorktree({ path: linked, mainPath: repo });
    if (!('id' in managed)) throw new Error('worktree setup failed');
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const target = preview.snapshot.worktrees.find((worktree) => worktree.branch === 'profile');
    if (!target) throw new Error('missing target worktree');

    const result = await execute('profile', {
      deleteBranch: false,
      worktrees: [{ id: target.id, mode: 'list-only' }],
    });

    expect(result.result).toMatchObject({ ok: true, phase: 'closed' });
    expect(existsSync(linked)).toBe(true);
    expect(git(repo, 'worktree', 'list', '--porcelain')).toContain(linked.replace(/\\/g, '/'));
    expect(workspaces.get(managed.id)).toBeUndefined();
    expect(git(repo, 'show-ref', '--verify', 'refs/heads/profile')).toContain('refs/heads/profile');
  }, 240_000);

  it('刪資料夾保留分支會移除資料夾、Git 登記與工作區，但保留 local ref', async () => {
    const linked = join(root, 'profile-worktree');
    git(repo, 'branch', 'profile');
    git(repo, 'worktree', 'add', linked, 'profile');
    const managed = workspaces.addWorktree({ path: linked, mainPath: repo });
    if (!('id' in managed)) throw new Error('worktree setup failed');
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const target = preview.snapshot.worktrees.find((worktree) => worktree.branch === 'profile');
    if (!target) throw new Error('missing target worktree');

    const result = await execute('profile', {
      deleteBranch: false,
      acceptRisk: true,
      worktrees: [{ id: target.id, mode: 'delete-folder' }],
    });

    expect(result.result).toMatchObject({ ok: true, phase: 'closed' });
    expect(existsSync(linked)).toBe(false);
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(linked);
    expect(workspaces.get(managed.id)).toBeUndefined();
    expect(git(repo, 'show-ref', '--verify', 'refs/heads/profile')).toContain('refs/heads/profile');
  }, 240_000);

  it('locked worktree 必須明確 unlock 才能完整清理', async () => {
    const linked = join(root, 'profile-worktree');
    git(repo, 'branch', 'profile');
    git(repo, 'worktree', 'add', linked, 'profile');
    git(repo, 'worktree', 'lock', '--reason', '重要工作', linked);
    const managed = workspaces.addWorktree({ path: linked, mainPath: repo });
    if (!('id' in managed)) throw new Error('worktree setup failed');
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const target = preview.snapshot.worktrees.find((worktree) => worktree.branch === 'profile');
    expect(target).toMatchObject({ locked: true, lockReason: '重要工作' });
    if (!target) return;

    const blocked = await execute('profile', {
      acceptRisk: true,
      worktrees: [{ id: target.id, mode: 'full-cleanup' }],
    });
    expect(blocked.result.ok).toBe(false);
    if (!blocked.result.ok) {
      expect(['worktree-locked', 'state-changed']).toContain(blocked.result.code);
    }
    expect(existsSync(linked)).toBe(true);

    const unlocked = await execute('profile', {
      acceptRisk: true,
      worktrees: [{ id: target.id, mode: 'full-cleanup', unlock: true }],
    });
    expect(unlocked.result).toMatchObject({ ok: true, phase: 'closed' });
    expect(existsSync(linked)).toBe(false);
    expect(gitFails(repo, 'show-ref', '--verify', 'refs/heads/profile')).toBe(true);
  }, 300_000);

  it('prunable worktree 只移除指定失效登記並保留本地分支', async () => {
    const linked = join(root, 'profile-worktree');
    git(repo, 'branch', 'profile');
    git(repo, 'worktree', 'add', linked, 'profile');
    const managed = workspaces.addWorktree({ path: linked, mainPath: repo });
    if (!('id' in managed)) throw new Error('worktree setup failed');
    rmSync(linked, { recursive: true, force: true });
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const target = preview.snapshot.worktrees.find((worktree) => worktree.branch === 'profile');
    expect(target?.prunable).toBe(true);
    if (!target) return;

    const result = await execute('profile', {
      deleteBranch: false,
      worktrees: [{ id: target.id, mode: 'stale-registration' }],
    });

    expect(result.result).toMatchObject({ ok: true, phase: 'closed' });
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(linked);
    expect(workspaces.get(managed.id)).toBeUndefined();
    expect(git(repo, 'show-ref', '--verify', 'refs/heads/profile')).toContain('refs/heads/profile');
  }, 300_000);

  it('retained ref 集合在確認後變動會拒絕舊 lease 並保留目標分支', async () => {
    git(repo, 'branch', 'profile');
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    git(repo, 'tag', 'after-preview');

    const result = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      localPlan: { worktrees: [] },
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });

    expect(result).toMatchObject({ ok: false, code: 'state-changed' });
    expect(git(repo, 'show-ref', '--verify', 'refs/heads/profile')).toContain('refs/heads/profile');
  }, 240_000);

  it('worktree HEAD 在 preview 後改變會拒絕舊 lease，不刪目標分支', async () => {
    const linked = join(root, 'linked-worktree');
    git(repo, 'branch', 'profile');
    git(repo, 'branch', 'keep');
    git(repo, 'worktree', 'add', linked, 'keep');
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    git(linked, 'checkout', '--detach', 'HEAD');

    const result = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      localPlan: { worktrees: [] },
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });

    expect(result).toMatchObject({ ok: false, code: 'state-changed' });
    expect(git(repo, 'show-ref', '--verify', 'refs/heads/profile')).toContain('refs/heads/profile');
  }, 240_000);

  it('shallow repository 的不可達 commit 數只標示本機下限，不冒充確定總數', async () => {
    git(repo, 'branch', 'profile');
    writeFileSync(join(repo, '.git', 'shallow'), `${git(repo, 'rev-parse', 'main')}\n`);

    const preview = await service.preview({ wsId, branch: 'profile' });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.snapshot.objectGraph.shallow).toBe(true);
    expect(preview.snapshot.localRisk.exact).toBe(false);
    expect(preview.snapshot.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'object-graph-incomplete' }),
    ]));
    const blocked = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      localPlan: { worktrees: [] },
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    expect(blocked).toMatchObject({ ok: false, code: 'force-required' });
  }, 240_000);
});
