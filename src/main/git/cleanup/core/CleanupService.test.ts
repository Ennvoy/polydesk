import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateStore } from '../../../store/StateStore';
import { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../../../workspace/workspaceLifecycle';
import { CleanupService } from './CleanupService';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 30_000 }).toString('utf8').trim();
}

describe('CleanupService compare-and-prepare', () => {
  let root: string;
  let repo: string;
  let userData: string;
  let wsId: string;
  let service: CleanupService;
  let workspaces: WorkspaceManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-cleanup-service-'));
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

    const state = new StateStore(join(userData, 'state.json'));
    state.load();
    workspaces = new WorkspaceManager(state, new WorkspaceLifecycle(), userData);
    const workspace = workspaces.add({ path: repo });
    if (!('id' in workspace)) throw new Error('workspace setup failed');
    wsId = workspace.id;
    service = new CleanupService(workspaces, userData);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lease 完全一致才建立 prepared journal，且同 repo 第二份計畫被擋', async () => {
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const executed = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    expect(executed).toMatchObject({ ok: true, phase: 'prepared', journalId: expect.any(String) });
    expect(existsSync(join(userData, 'branch-cleanup', 'claims.json'))).toBe(true);
    expect(git(repo, 'rev-parse', 'refs/heads/profile')).toBe(preview.snapshot.target.oid);

    const second = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    expect(second).toMatchObject({ ok: false, code: 'active-cleanup' });
  }, 120_000);

  it('branch tip 在確認後變動時回新 preview 且不建立 journal', async () => {
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    git(repo, 'checkout', 'profile');
    writeFileSync(join(repo, 'changed.txt'), 'changed\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'changed after preview');
    git(repo, 'checkout', 'main');

    const executed = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: true, acceptExternalWriteRisk: false, remoteTargets: [] },
    });

    expect(executed).toMatchObject({ ok: false, code: 'state-changed', currentPreview: { ok: true } });
    expect(service.status().journals).toEqual([]);
  }, 120_000);

  it('prepared 計畫只在完整 pre-state 仍相同時可取消', async () => {
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const executed = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;

    expect(await service.cancelPrepared(wsId, executed.journalId)).toEqual({ ok: true });
    expect(service.status().journals).toEqual([]);
  }, 120_000);

  it('mutating 尚無任何 checkpoint 且完整 pre-state 一致時可在恢復階段降回 prepared', async () => {
    const preview = await service.preview({ wsId, branch: 'profile' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const executed = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    service.markMutating(executed.journalId);

    const recovered = await service.recoverLocal();

    expect(recovered.journals).toContainEqual(expect.objectContaining({ journalId: executed.journalId, phase: 'prepared' }));
  }, 120_000);

  it('同一份 lease 與 journal 先清本地 ref，再完成遠端 expected-OID 刪除', async () => {
    const bare = join(root, 'remote.git');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '--bare');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', 'origin', 'main', 'profile');

    const preview = await service.preview({
      wsId,
      branch: 'profile',
      remoteTargets: [{ remote: 'origin', branch: 'profile' }],
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.snapshot.remote).toMatchObject({
      selectedEndpointIds: [expect.any(String)],
      unresolvedTargets: [],
      plan: { endpoints: [expect.objectContaining({ remote: 'origin', branch: 'profile', status: 'exists' })] },
    });
    const result = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      localPlan: { worktrees: [] },
      confirmation: {
        forceLocal: false,
        acceptExternalWriteRisk: false,
        remoteTargets: [{ remote: 'origin', branch: 'profile' }],
      },
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(result).toMatchObject({ ok: true, phase: 'closed', remote: { ok: true } });
    expect(() => git(repo, 'show-ref', '--verify', 'refs/heads/profile')).toThrow();
    expect(() => git(bare, 'show-ref', '--verify', 'refs/heads/profile')).toThrow();
    expect(service.status().journals).toEqual([]);
  }, 180_000);

  it('遠端刪除被拒絕時，本地清理已先完成且 journal 保留供重試', async () => {
    const bare = join(root, 'rejecting.git');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '--bare');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', 'origin', 'main', 'profile');
    git(bare, 'config', 'receive.denyDeletes', 'true');
    const preview = await service.preview({ wsId, branch: 'profile', remoteTargets: [{ remote: 'origin', branch: 'profile' }] });
    if (!preview.ok) throw new Error(JSON.stringify(preview));

    const result = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      localPlan: { worktrees: [] },
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [{ remote: 'origin', branch: 'profile' }] },
    });

    expect(result).toMatchObject({ ok: false, code: 'remote-cleanup-failed', journalId: expect.any(String) });
    expect(() => git(repo, 'show-ref', '--verify', 'refs/heads/profile')).toThrow();
    expect(git(bare, 'show-ref', '--verify', 'refs/heads/profile')).not.toBe('');
    expect(service.status().journals).toContainEqual(expect.objectContaining({ phase: 'mutating', checkpoints: expect.arrayContaining(['local-ref-deleted']) }));
  }, 180_000);

  it('合併清理風險會排除計畫中確定刪除的 remote-tracking ref', async () => {
    git(repo, 'checkout', 'profile');
    writeFileSync(join(repo, 'profile-only.txt'), 'profile only\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'profile only');
    git(repo, 'checkout', 'main');
    const bare = join(root, 'risk.git');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '--bare');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', 'origin', 'profile');

    const localOnly = await service.preview({ wsId, branch: 'profile' });
    if (!localOnly.ok) throw new Error(JSON.stringify(localOnly));
    expect(localOnly.snapshot.localRisk.lostCommitCount).toBe(0);

    const combined = await service.preview({
      wsId,
      branch: 'profile',
      remoteTargets: [{ remote: 'origin', branch: 'profile' }],
    });
    if (!combined.ok) throw new Error(JSON.stringify(combined));
    expect(combined.snapshot.localRisk).toMatchObject({
      lostCommitCount: 1,
      plannedRemoteTrackingRefs: ['refs/remotes/origin/profile'],
    });
  }, 180_000);

  it('恢復前拒絕被竄改的 payload', async () => {
    const preview = await service.preview({ wsId, branch: 'profile' });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const prepared = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    service.markMutating(prepared.journalId);
    writeFileSync(join(userData, 'branch-cleanup', 'active', `${prepared.journalId}.payload.json`), '{"tampered":true}', 'utf8');
    await expect(service.resume({ wsId, journalId: prepared.journalId })).resolves.toMatchObject({ ok: false, code: 'recovery-required' });
  }, 180_000);

  it('恢復前拒絕同路徑替換後的 repository 世代', async () => {
    const preview = await service.preview({ wsId, branch: 'profile' });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const prepared = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    service.markMutating(prepared.journalId);

    rmSync(join(repo, '.git'), { recursive: true, force: true });
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'replacement@example.com');
    git(repo, 'config', 'user.name', 'Replacement Repo');
    writeFileSync(join(repo, 'replacement.txt'), 'replacement\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'replacement');

    await expect(service.resume({ wsId, journalId: prepared.journalId })).resolves.toMatchObject({
      ok: false,
      code: 'recovery-required',
      error: expect.stringContaining('不是建立 journal 時的 repository 實例'),
    });
  }, 180_000);

  it('quarantine 待辦依 repository fingerprint 隔離到正確工作區', async () => {
    const preview = await service.preview({ wsId, branch: 'profile' });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const prepared = await service.execute({
      wsId,
      branch: 'profile',
      leaseToken: preview.leaseToken,
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    });
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    service.markMutating(prepared.journalId);
    writeFileSync(join(userData, 'branch-cleanup', 'active', `${prepared.journalId}.payload.json`), '{"tampered":true}', 'utf8');
    await service.recoverLocal();

    const other = join(root, 'other-repo');
    mkdirSync(other, { recursive: true });
    git(other, 'init', '-b', 'main');
    git(other, 'config', 'user.email', 'other@example.com');
    git(other, 'config', 'user.name', 'Other Repo');
    writeFileSync(join(other, 'other.txt'), 'other\n');
    git(other, 'add', '.');
    git(other, 'commit', '-m', 'other');
    const otherWorkspace = workspaces.add({ path: other });
    if (!('id' in otherWorkspace)) throw new Error('other workspace setup failed');

    await expect(service.statusForWorkspace(wsId)).resolves.toMatchObject({
      journals: [expect.objectContaining({ journalId: prepared.journalId, phase: 'quarantine' })],
    });
    await expect(service.statusForWorkspace(otherWorkspace.id)).resolves.toMatchObject({ journals: [] });
  }, 180_000);
});
