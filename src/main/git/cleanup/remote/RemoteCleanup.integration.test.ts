import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteCleanupService } from './RemoteCleanupService';
import { endpointFingerprint } from './remoteIdentity';
import type { RemoteCleanupCheckpoint, RemoteLeaseGuard } from './RemoteCleanupTypes';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 30_000 }).toString('utf8').trim();
}

function refExists(cwd: string, ref: string): boolean {
  try {
    git(cwd, 'show-ref', '--verify', ref);
    return true;
  } catch {
    return false;
  }
}

describe('租約式遠端分支清理真 Git 鏈路', () => {
  let root: string;
  let repo: string;
  let claimsDigest: string;
  let guard: RemoteLeaseGuard;
  let checkpoints: RemoteCleanupCheckpoint[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-remote-cleanup-'));
    repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Polydesk Test');
    git(repo, 'config', 'core.autocrlf', 'false');
    git(repo, 'config', 'core.logAllRefUpdates', 'true');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'base');
    git(repo, 'checkout', '-b', 'profile');
    writeFileSync(join(repo, 'profile.txt'), 'profile\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'profile');
    git(repo, 'checkout', 'main');
    claimsDigest = 'claims:v1';
    guard = { snapshot: async () => claimsDigest };
    checkpoints = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function bare(name: string): string {
    const path = join(root, name);
    mkdirSync(path, { recursive: true });
    git(path, 'init', '--bare');
    return path;
  }

  function journal() {
    return { checkpoint: async (checkpoint: RemoteCleanupCheckpoint) => { checkpoints.push(checkpoint); } };
  }

  it('pushurl 完整取代 fetch URL，多 endpoint 個別刪除且不重做已完成 checkpoint', async () => {
    const fetchOnly = bare('fetch-only.git');
    const pushA = bare('push-a.git');
    const pushB = bare('push-b.git');
    git(repo, 'remote', 'add', 'origin', fetchOnly);
    git(repo, 'config', '--add', 'remote.origin.pushurl', pushA);
    git(repo, 'config', '--add', 'remote.origin.pushurl', pushB);
    git(repo, 'config', 'branch.profile.remote', 'origin');
    git(repo, 'config', 'branch.profile.merge', 'refs/heads/profile');
    git(repo, 'push', pushA, 'profile:refs/heads/profile');
    git(repo, 'push', pushB, 'profile:refs/heads/profile');

    const service = new RemoteCleanupService(guard);
    const plan = await service.discover(repo, 'profile');
    expect(plan.endpoints).toHaveLength(2);
    expect(new Set(plan.endpoints.map((endpoint) => endpoint.fingerprint))).toEqual(new Set([
      endpointFingerprint(pushA), endpointFingerprint(pushB),
    ]));
    expect(plan.endpoints.every((endpoint) => endpoint.status === 'exists' && endpoint.preselected)).toBe(true);

    const selectedEndpointIds = plan.endpoints.map((endpoint) => endpoint.id);
    const result = await service.execute(repo, { token: plan.token, selectedEndpointIds }, journal());
    expect(result.ok).toBe(true);
    expect(result.endpoints.every((endpoint) => endpoint.status === 'deleted')).toBe(true);
    expect(refExists(pushA, 'refs/heads/profile')).toBe(false);
    expect(refExists(pushB, 'refs/heads/profile')).toBe(false);
    expect(checkpoints.filter((entry) => entry.kind === 'endpoint-deleted')).toHaveLength(2);
    expect(JSON.stringify(checkpoints)).not.toContain(pushA);

    const resumedService = new RemoteCleanupService(guard);
    await resumedService.resume(repo, plan);
    const repeated = await resumedService.execute(repo, {
      token: plan.token,
      selectedEndpointIds,
      completedEndpointIds: selectedEndpointIds,
      permanentlyRetainedTrackingRefs: plan.trackingRefs.map((lease) => lease.localRef),
    }, journal());
    expect(repeated.ok).toBe(true);
    expect(repeated.endpoints.every((endpoint) => endpoint.status === 'already-completed')).toBe(true);
  }, 120_000);

  it('實際 upstream 名稱不同時預選 upstream，同名 branch 保持未選', async () => {
    const remote = bare('origin.git');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', remote, 'profile:refs/heads/profile');
    git(repo, 'push', remote, 'profile:refs/heads/deployed-profile');
    git(repo, 'config', 'branch.profile.remote', 'origin');
    git(repo, 'config', 'branch.profile.merge', 'refs/heads/deployed-profile');

    const plan = await new RemoteCleanupService(guard).discover(repo, 'profile');
    const sameName = plan.endpoints.find((endpoint) => endpoint.branch === 'profile');
    const upstream = plan.endpoints.find((endpoint) => endpoint.branch === 'deployed-profile');
    expect(sameName).toMatchObject({ status: 'exists', preselected: false });
    expect(upstream).toMatchObject({ status: 'exists', preselected: true });
  }, 120_000);

  it('第二個 endpoint tip 改變時保留新 commit，第一個成功會先 checkpoint', async () => {
    const pushA = bare('push-a.git');
    const pushB = bare('push-b.git');
    git(repo, 'remote', 'add', 'origin', pushA);
    git(repo, 'config', '--add', 'remote.origin.pushurl', pushA);
    git(repo, 'config', '--add', 'remote.origin.pushurl', pushB);
    git(repo, 'push', pushA, 'profile:refs/heads/profile');
    git(repo, 'push', pushB, 'profile:refs/heads/profile');

    const service = new RemoteCleanupService(guard);
    const plan = await service.discover(repo, 'profile');
    const staleEndpoint = plan.endpoints[1];
    if (!staleEndpoint) throw new Error('missing second endpoint');
    const staleBare = staleEndpoint.fingerprint === endpointFingerprint(pushA) ? pushA : pushB;
    git(staleBare, 'update-ref', 'refs/heads/profile', git(repo, 'rev-parse', 'main'));

    const result = await service.execute(repo, {
      token: plan.token,
      selectedEndpointIds: plan.endpoints.map((endpoint) => endpoint.id),
    }, journal());
    expect(result.ok).toBe(false);
    expect(result.endpoints.map((endpoint) => endpoint.status)).toEqual(['deleted', 'stale']);
    expect(refExists(staleBare, 'refs/heads/profile')).toBe(true);
    expect(checkpoints.filter((entry) => entry.kind === 'endpoint-deleted')).toHaveLength(1);
  }, 120_000);

  it('receive-pack 隱藏精確 ref 時保持 unknown 且不可預選', async () => {
    const remote = bare('hidden.git');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', remote, 'profile:refs/heads/profile');
    git(remote, 'config', 'receive.hideRefs', 'refs/heads/profile');

    const plan = await new RemoteCleanupService(guard).discover(repo, 'profile');
    expect(plan.endpoints).toEqual([expect.objectContaining({ status: 'unknown', preselected: false })]);
    expect(refExists(remote, 'refs/heads/profile')).toBe(true);
  }, 120_000);

  it('完成所有 producer endpoint 後以單一 transaction 清 tracking ref、典型 HEAD 與 reflog', async () => {
    const remote = bare('origin.git');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', remote, 'profile:refs/heads/profile');
    git(repo, 'fetch', 'origin', 'profile:refs/remotes/origin/profile');
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/profile');
    expect(refExists(repo, 'refs/remotes/origin/profile')).toBe(true);

    const service = new RemoteCleanupService(guard);
    const plan = await service.discover(repo, 'profile');
    const endpoint = plan.endpoints.find((entry) => entry.status === 'exists');
    if (!endpoint) throw new Error('missing endpoint');
    const result = await service.execute(repo, {
      token: plan.token,
      selectedEndpointIds: [endpoint.id],
    }, journal());

    expect(result.ok).toBe(true);
    expect(result.trackingRefsDeleted).toEqual(['refs/remotes/origin/profile']);
    expect(refExists(repo, 'refs/remotes/origin/profile')).toBe(false);
    expect(refExists(repo, 'refs/remotes/origin/HEAD')).toBe(false);
    expect(() => git(repo, 'reflog', 'exists', 'refs/remotes/origin/profile')).toThrow();
  }, 120_000);

  it('任一非典型 symref 指向 tracking ref 時保留本機 ref', async () => {
    const remote = bare('origin.git');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', remote, 'profile:refs/heads/profile');
    git(repo, 'fetch', 'origin', 'profile:refs/remotes/origin/profile');
    git(repo, 'symbolic-ref', 'refs/polydesk/profile-pointer', 'refs/remotes/origin/profile');

    const service = new RemoteCleanupService(guard);
    const plan = await service.discover(repo, 'profile');
    expect(plan.trackingRefs[0]?.symrefs).toEqual([expect.objectContaining({
      ref: 'refs/polydesk/profile-pointer',
      typical: false,
    })]);
    const endpoint = plan.endpoints.find((entry) => entry.status === 'exists');
    if (!endpoint) throw new Error('missing endpoint');
    const result = await service.execute(repo, {
      token: plan.token,
      selectedEndpointIds: [endpoint.id],
    }, journal());

    expect(result.ok).toBe(true);
    expect(result.trackingRefsDeleted).toEqual([]);
    expect(result.trackingRefsRetained[0]?.reason).toContain('非典型 symref');
    expect(refExists(repo, 'refs/remotes/origin/profile')).toBe(true);
  }, 120_000);

  it('claim lease 改變或 object graph 不完整時不送出刪除', async () => {
    const remote = bare('origin.git');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', remote, 'profile:refs/heads/profile');
    const service = new RemoteCleanupService(guard);
    const plan = await service.discover(repo, 'profile');
    const endpoint = plan.endpoints.find((entry) => entry.status === 'exists');
    if (!endpoint) throw new Error('missing endpoint');
    claimsDigest = 'claims:v2';
    const stale = await service.execute(repo, {
      token: plan.token,
      selectedEndpointIds: [endpoint.id],
    }, journal());
    expect(stale.endpoints[0]?.status).toBe('stale');
    expect(refExists(remote, 'refs/heads/profile')).toBe(true);

    claimsDigest = 'claims:v1';
    git(repo, 'config', 'remote.origin.promisor', 'true');
    const incompleteService = new RemoteCleanupService(guard);
    const incomplete = await incompleteService.discover(repo, 'profile');
    expect(incomplete.objectGraphComplete).toBe(false);
    await expect(incompleteService.execute(repo, {
      token: incomplete.token,
      selectedEndpointIds: incomplete.endpoints.map((entry) => entry.id),
    }, journal())).rejects.toThrow('歷史不完整');
    expect(refExists(remote, 'refs/heads/profile')).toBe(true);
  }, 120_000);
});
