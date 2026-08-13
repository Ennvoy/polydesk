import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import { CleanupJournalStore } from '../../../store/cleanup/CleanupJournalStore';
import type { GitCleanupExecuteRequest, GitCleanupSnapshot } from '../../../../shared/gitCleanup';
import { CleanupGitRunner, type CleanupGitExec } from '../core/CleanupGitRunner';
import { digest } from '../core/hash';
import { LocalCleanupExecutor } from './LocalCleanupExecutor';

describe('LocalCleanupExecutor checkout 競態補償', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('target CAS 後發現新 checkout，立即以 expected-absent 恢復 ref 並保留 metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-local-race-'));
    roots.push(root);
    const updateInputs: string[] = [];
    const exec: CleanupGitExec = (_file, args, _options, callback) => {
      let input = '';
      const child = {
        stdin: {
          end(value?: string | Uint8Array): void {
            input = typeof value === 'string' ? value : value ? Buffer.from(value).toString('utf8') : '';
          },
        },
      } as unknown as ChildProcess;
      setImmediate(() => {
        if (args.includes('update-ref')) {
          updateInputs.push(input);
          callback(null, Buffer.from(''), Buffer.from(''));
          return;
        }
        if (args.includes('worktree') && args.includes('list')) {
          callback(null, Buffer.from('worktree C:/repo/new\0HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0branch refs/heads/profile\0\0'), Buffer.from(''));
          return;
        }
        if (args.includes('for-each-ref')) {
          callback(null, Buffer.from(`refs/heads/main\0${'a'.repeat(40)}\0commit\0\n`), Buffer.from(''));
          return;
        }
        callback(null, Buffer.from(''), Buffer.from(''));
      });
      return child;
    };
    const journals = new CleanupJournalStore(root);
    const prepared = journals.createPrepared({
      repositoryFingerprint: 'repo-fingerprint',
      repositoryGeneration: 'repo-generation',
      payload: { test: true },
    });
    const workspaces = { list: () => [] } as unknown as WorkspaceManager;
    const executor = new LocalCleanupExecutor(workspaces, journals, new CleanupGitRunner(exec));
    const oid = 'b'.repeat(40);
    const retainedRefs = [{ ref: 'refs/heads/main', oid: 'a'.repeat(40), objectType: 'commit', symref: '' }];
    const snapshot: GitCleanupSnapshot = {
      repository: { fingerprint: 'repo-fingerprint', commonDirDigest: 'common', evidenceDigest: 'evidence' },
      target: { ref: 'refs/heads/profile', oid },
      baseline: { ref: 'refs/heads/main', oid: 'a'.repeat(40) },
      retainedRefs: { count: retainedRefs.length, digest: digest({ refs: retainedRefs, privateScopes: [] }), refs: retainedRefs, privateScopes: [] },
      worktrees: [],
      metadata: {
        digest: 'metadata',
        entries: [{ scope: 'local', origin: 'file:.git/config', key: 'branch.profile.remote', value: 'origin', mutable: true }],
        reflogDigest: 'reflog',
        reflogExists: true,
      },
      objectGraph: { complete: true, shallow: false, promisor: false, missingObjectCount: 0 },
      localRisk: { safeDelete: true, lostCommitCount: 0, exact: true },
      capabilities: { reflogDrop: true, privateRefs: true, operationMarkers: true },
      switchCandidates: [],
      blockers: [],
    };
    const request: GitCleanupExecuteRequest = {
      wsId: 'ws',
      branch: 'profile',
      leaseToken: 'lease',
      localPlan: { worktrees: [] },
      confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
    };

    const result = await executor.execute(root, prepared.journalId, request, snapshot);

    expect(result).toMatchObject({ ok: false, code: 'local-cleanup-failed', journalId: prepared.journalId });
    expect(updateInputs).toHaveLength(2);
    expect(updateInputs[0]).toContain(`delete refs/heads/profile ${oid}`);
    expect(updateInputs[1]).toContain(`create refs/heads/profile ${oid}`);
    expect(journals.list().claims).toEqual([
      expect.objectContaining({ journalId: prepared.journalId, phase: 'mutating' }),
    ]);
  });
});
