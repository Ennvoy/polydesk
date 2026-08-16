import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CleanupJournalStore, CleanupStoreError } from './CleanupJournalStore';

describe('CleanupJournalStore', () => {
  let root: string;
  let store: CleanupJournalStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-cleanup-store-'));
    store = new CleanupJournalStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prepared envelope 是 claim 真值，index 遺失時會重建且阻擋同 repo 第二份本機清理', () => {
    const created = store.createPrepared({
      repositoryFingerprint: 'repo-fingerprint',
      repositoryGeneration: 'repo-generation',
      payload: { leaseToken: 'lease-1', request: { branch: 'profile' } },
    });
    expect(created.phase).toBe('prepared');

    unlinkSync(join(root, 'branch-cleanup', 'claims.json'));
    expect(store.rebuildClaims()).toMatchObject({ globalBlocked: false, claims: [{ repositoryFingerprint: 'repo-fingerprint' }] });
    expect(() => store.createPrepared({
      repositoryFingerprint: 'repo-fingerprint',
      repositoryGeneration: 'repo-generation',
      payload: { leaseToken: 'lease-2', request: { branch: 'other' } },
    })).toThrowError(CleanupStoreError);
  });

  it('payload 損壞會 quarantine 並保留 repository claim，人工封存也不解鎖 mutating claim', () => {
    const created = store.createPrepared({
      repositoryFingerprint: 'repo-fingerprint',
      repositoryGeneration: 'repo-generation',
      payload: { leaseToken: 'lease-1' },
    });
    store.markMutating(created.journalId);
    writeFileSync(join(root, 'branch-cleanup', 'active', `${created.journalId}.payload.json`), '{"tampered":true}', 'utf8');

    const rebuilt = store.rebuildClaims();
    expect(rebuilt.globalBlocked).toBe(false);
    expect(rebuilt.claims).toContainEqual(expect.objectContaining({ repositoryFingerprint: 'repo-fingerprint', phase: 'quarantine' }));
    expect(store.archiveQuarantine(created.journalId)).toEqual({ archived: true, claimReleased: false });
    expect(store.rebuildClaims().claims).toContainEqual(expect.objectContaining({ repositoryFingerprint: 'repo-fingerprint' }));
  });

  it('active payload 必須通過 envelope checksum，quarantine 只接受原始 payload 證據恢復', () => {
    const original = { schemaVersion: 1, leaseToken: 'lease-1', checkpoints: [] };
    const created = store.createPrepared({
      repositoryFingerprint: 'repo-fingerprint',
      repositoryGeneration: 'repo-generation',
      payload: original,
    });
    store.markMutating(created.journalId);
    writeFileSync(join(root, 'branch-cleanup', 'active', `${created.journalId}.payload.json`), '{"tampered":true}', 'utf8');
    expect(() => store.readVerifiedActive(created.journalId)).toThrowError(expect.objectContaining({ code: 'invalid-payload' }));

    store.rebuildClaims();
    expect(() => store.restoreQuarantinedPayload(created.journalId, { wrong: true })).toThrowError(expect.objectContaining({ code: 'evidence-mismatch' }));
    store.restoreQuarantinedPayload(created.journalId, original);
    expect(store.readVerifiedActive(created.journalId)).toMatchObject({ payload: original, envelope: { phase: 'reconciling' } });
  });

  it('mutating checkpoint 會先更新 payload checksum 再推進 envelope generation', () => {
    const created = store.createPrepared({
      repositoryFingerprint: 'repo-fingerprint',
      repositoryGeneration: 'repo-generation',
      payload: { leaseToken: 'lease-1', checkpoints: [] },
    });
    const mutating = store.markMutating(created.journalId);
    const checkpointed = store.checkpoint(created.journalId, 'local-ref-deleted');

    expect(checkpointed.generation).toBeGreaterThan(mutating.generation);
    expect(checkpointed.payloadChecksum).not.toBe(mutating.payloadChecksum);
    expect(store.readPayload(created.journalId)).toMatchObject({ checkpoints: ['local-ref-deleted'] });
    expect(store.rebuildClaims()).toMatchObject({ globalBlocked: false });
  });

  it('SCM status peek 不重寫 claim bytes、mtime 或 journal phase', () => {
    const created = store.createPrepared({
      repositoryFingerprint: 'repo-fingerprint',
      repositoryGeneration: 'repo-generation',
      payload: { leaseToken: 'lease-1', checkpoints: [] },
    });
    store.markMutating(created.journalId);
    const claimsPath = join(root, 'branch-cleanup', 'claims.json');
    const envelopePath = join(root, 'branch-cleanup', 'active', `${created.journalId}.envelope.json`);
    const beforeClaims = readFileSync(claimsPath);
    const beforeEnvelope = readFileSync(envelopePath);
    const beforeClaimsMtime = statSync(claimsPath).mtimeMs;
    const beforeEnvelopeMtime = statSync(envelopePath).mtimeMs;

    expect(store.peek().claims).toContainEqual(expect.objectContaining({ journalId: created.journalId, phase: 'mutating' }));
    expect(store.peek().claims).toContainEqual(expect.objectContaining({ journalId: created.journalId, phase: 'mutating' }));

    expect(readFileSync(claimsPath)).toEqual(beforeClaims);
    expect(readFileSync(envelopePath)).toEqual(beforeEnvelope);
    expect(statSync(claimsPath).mtimeMs).toBe(beforeClaimsMtime);
    expect(statSync(envelopePath).mtimeMs).toBe(beforeEnvelopeMtime);
  });

  it('無法驗證 envelope 歸屬時全域 fail-closed', () => {
    const active = join(root, 'branch-cleanup', 'active');
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, 'unknown.envelope.json'), '{broken', 'utf8');

    const rebuilt = store.rebuildClaims();

    expect(rebuilt.globalBlocked).toBe(true);
    expect(rebuilt.issues).toContainEqual(expect.objectContaining({ code: 'unattributed-envelope' }));
    expect(() => store.createPrepared({
      repositoryFingerprint: 'new-repo',
      repositoryGeneration: 'generation',
      payload: { leaseToken: 'lease' },
    })).toThrowError(expect.objectContaining({ code: 'global-blocked' }));
  });

  it('repository generation 辨識同路徑替換，實體目錄移動則保留世代', () => {
    const repo = join(root, 'repo-common');
    mkdirSync(repo);
    const first = store.resolveRepositoryIdentity(repo, 'evidence-a');

    const moved = join(root, 'repo-moved');
    renameSync(repo, moved);
    const afterMove = store.resolveRepositoryIdentity(moved, 'evidence-a');
    expect(afterMove.generation).toBe(first.generation);

    rmSync(moved, { recursive: true, force: true });
    mkdirSync(moved);
    writeFileSync(join(moved, 'different'), 'new repository instance');
    const replaced = store.resolveRepositoryIdentity(moved, 'evidence-a');
    expect(replaced.generation).not.toBe(first.generation);

    const registry = readFileSync(join(root, 'branch-cleanup', 'repository-identities.json'), 'utf8');
    expect(registry).not.toContain(repo);
    expect(registry).not.toContain(moved);
  });

  it('同 repository 世代即使路徑 fingerprint 改變也不能建立第二份 claim', () => {
    store.createPrepared({
      repositoryFingerprint: 'old-path',
      repositoryGeneration: 'same-generation',
      payload: { leaseToken: 'lease-1' },
    });

    expect(() => store.createPrepared({
      repositoryFingerprint: 'new-path',
      repositoryGeneration: 'same-generation',
      payload: { leaseToken: 'lease-2' },
    })).toThrowError(expect.objectContaining({ code: 'active-cleanup' }));
  });

  it('搬移後可唯讀查回 repository 世代且不改寫 identity registry', () => {
    const repo = join(root, 'repo-common');
    mkdirSync(repo);
    const identity = store.resolveRepositoryIdentity(repo, 'evidence-a');
    const registryPath = join(root, 'branch-cleanup', 'repository-identities.json');
    const before = readFileSync(registryPath);
    const beforeMtime = statSync(registryPath).mtimeMs;
    const moved = join(root, 'repo-moved');
    renameSync(repo, moved);

    expect(store.repositoryGenerations(moved)).toContain(identity.generation);
    expect(readFileSync(registryPath)).toEqual(before);
    expect(statSync(registryPath).mtimeMs).toBe(beforeMtime);
  });
});
