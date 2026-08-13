import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateStore } from '../../../store/StateStore';
import { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../../../workspace/workspaceLifecycle';
import { CleanupPreviewService } from './CleanupPreview';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 30_000 }).toString('utf8').trim();
}

function treeDigest(root: string): string[] {
  if (!existsSync(root)) return [];
  const walk = (dir: string, prefix = ''): string[] => {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      const key = prefix ? `${prefix}/${name}` : name;
      const stat = statSync(path);
      if (stat.isDirectory()) return [key, ...walk(path, key)];
      return [`${key}:${stat.size}:${readFileSync(path).toString('hex')}`];
    });
  };
  return walk(root);
}

describe('CleanupPreviewService', () => {
  let root: string;
  let repo: string;
  let userData: string;
  let wsId: string;
  let service: CleanupPreviewService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-cleanup-preview-'));
    repo = join(root, 'repo');
    userData = join(root, 'userData');
    mkdirSync(repo, { recursive: true });
    mkdirSync(userData, { recursive: true });
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Polydesk Test');
    git(repo, 'config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'base');
    git(repo, 'branch', 'profile');
    git(repo, 'branch', 'switch-target');
    git(repo, 'config', 'branch.profile.description', 'temporary profile');

    const store = new StateStore(join(userData, 'state.json'));
    store.load();
    const manager = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
    const workspace = manager.add({ path: repo });
    if (!('id' in workspace)) throw new Error('workspace setup failed');
    wsId = workspace.id;
    service = new CleanupPreviewService(manager);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('preview 收集 lease snapshot 且不改動 repository、worktree、metadata 或 userData', async () => {
    const beforeRefs = git(repo, 'show-ref');
    const beforeConfig = git(repo, 'config', '--local', '--list');
    const beforeReflog = git(repo, 'reflog', 'show', '--all');
    const beforeRepo = treeDigest(repo);
    const beforeUserData = treeDigest(userData);

    const preview = await service.preview({ wsId, branch: 'profile' });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.snapshot.target).toMatchObject({ ref: 'refs/heads/profile', oid: expect.stringMatching(/^[0-9a-f]{40,64}$/) });
    expect(preview.snapshot.baseline).toMatchObject({ ref: 'refs/heads/main', oid: expect.stringMatching(/^[0-9a-f]{40,64}$/) });
    expect(preview.snapshot.retainedRefs.count).toBeGreaterThan(0);
    expect(preview.snapshot.metadata.entries).toContainEqual(expect.objectContaining({ key: 'branch.profile.description', value: 'temporary profile' }));
    expect(preview.snapshot.worktrees).toContainEqual(expect.objectContaining({ branch: 'main', isMain: true }));
    expect(preview.snapshot.switchCandidates).toContain('switch-target');
    expect(preview.snapshot.objectGraph.complete).toBe(true);
    expect(preview.snapshot.capabilities.reflogDrop).toBe(true);
    expect(preview.snapshot.blockers).toEqual([]);
    expect(preview.leaseToken).toMatch(/^[0-9a-f]{64}$/);

    expect(git(repo, 'show-ref')).toBe(beforeRefs);
    expect(git(repo, 'config', '--local', '--list')).toBe(beforeConfig);
    expect(git(repo, 'reflog', 'show', '--all')).toBe(beforeReflog);
    expect(treeDigest(repo)).toEqual(beforeRepo);
    expect(treeDigest(userData)).toEqual(beforeUserData);
    expect(existsSync(join(userData, 'branch-cleanup'))).toBe(false);
  }, 60_000);

  it('以 git rev-parse --git-path 探測在途操作並 fail-closed', async () => {
    const marker = git(repo, 'rev-parse', '--git-path', 'MERGE_HEAD');
    writeFileSync(join(repo, marker), git(repo, 'rev-parse', 'HEAD') + '\n');

    const preview = await service.preview({ wsId, branch: 'profile' });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.snapshot.worktrees[0]?.operations).toContain('merge');
    expect(preview.snapshot.blockers).toContainEqual(expect.objectContaining({ code: 'operation-in-progress' }));
  });
});
