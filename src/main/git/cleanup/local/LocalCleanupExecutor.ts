import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GitCleanupExecuteRequest, GitCleanupExecuteResult, GitCleanupSnapshot } from '../../../../shared/gitCleanup';
import type { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import type { CleanupJournalStore } from '../../../store/cleanup/CleanupJournalStore';
import { CleanupGitRunner } from '../core/CleanupGitRunner';
import { digest } from '../core/hash';

function canonical(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function parseRefLeases(raw: string, scopePath?: string): GitCleanupSnapshot['retainedRefs']['refs'] {
  return raw.split(/\r?\n/).flatMap((line) => {
    const [ref = '', oid = '', objectType = '', symref = ''] = line.split('\0');
    return ref && oid ? [{ ref, oid, objectType, symref, ...(scopePath ? { scopePath } : {}) }] : [];
  });
}

function sortRefLeases(refs: GitCleanupSnapshot['retainedRefs']['refs']): GitCleanupSnapshot['retainedRefs']['refs'] {
  return refs.sort((a, b) =>
    (a.scopePath ?? '').localeCompare(b.scopePath ?? '') ||
    a.ref.localeCompare(b.ref) ||
    a.oid.localeCompare(b.oid) ||
    (a.objectType ?? '').localeCompare(b.objectType ?? '') ||
    (a.symref ?? '').localeCompare(b.symref ?? ''),
  );
}

export type WorktreeReconcileAction =
  | 'freeze-retry'
  | 'delist-preserve-path'
  | 'manual-preserve-path'
  | 'remove-registration-and-delist'
  | 'remove-registration'
  | 'delist-complete'
  | 'complete';

/** 決議 059 的 path/Git/Polydesk 八態單一對照表。 */
export function decideWorktreeReconciliation(pathExists: boolean, gitRegistered: boolean, polydeskRegistered: boolean): WorktreeReconcileAction {
  if (pathExists && gitRegistered) return 'freeze-retry';
  if (pathExists && !gitRegistered && polydeskRegistered) return 'delist-preserve-path';
  if (pathExists && !gitRegistered) return 'manual-preserve-path';
  if (!pathExists && gitRegistered && polydeskRegistered) return 'remove-registration-and-delist';
  if (!pathExists && gitRegistered) return 'remove-registration';
  if (!pathExists && !gitRegistered && polydeskRegistered) return 'delist-complete';
  return 'complete';
}

export class LocalCleanupExecutor {
  constructor(
    private readonly workspaces: WorkspaceManager,
    private readonly journals: CleanupJournalStore,
    private readonly git = new CleanupGitRunner(),
  ) {}

  validate(snapshot: GitCleanupSnapshot, request: GitCleanupExecuteRequest): GitCleanupExecuteResult | null {
    const plan = request.localPlan;
    if (!plan) return null;
    const deleteBranch = plan.deleteBranch !== false;
    const fatalBlocker = snapshot.blockers.find((blocker) => blocker.code !== 'object-graph-incomplete');
    if (fatalBlocker) return { ok: false, error: fatalBlocker.message, code: fatalBlocker.code };
    if (deleteBranch && !snapshot.localRisk.safeDelete && !request.confirmation.forceLocal) {
      return { ok: false, error: '此分支尚未安全合併，必須先檢視 commit 風險並明確確認強制清理。', code: 'force-required' };
    }
    if (deleteBranch && !snapshot.objectGraph.complete && !request.confirmation.forceLocal) {
      return { ok: false, error: 'repository 歷史不完整，commit 風險只有本機可見下限；必須明確確認未知風險。', code: 'force-required' };
    }

    const actions = new Map(plan.worktrees.map((action) => [action.id, action]));
    const occupying = snapshot.worktrees.filter((worktree) => worktree.branch === request.branch);
    const main = occupying.find((worktree) => worktree.isMain);
    if (deleteBranch && main) {
      if (!plan.switchTo) return { ok: false, error: '目前分支必須先選擇另一個本地分支切換。', code: 'switch-required' };
      if (!snapshot.switchCandidates.includes(plan.switchTo)) {
        return { ok: false, error: '切換候選已不可用或正被其他 worktree 使用。', code: 'switch-target-unavailable' };
      }
      if (main.dirty !== false) return { ok: false, error: '主工作樹有未提交或無法確認的變更，不能自動切換。', code: 'worktree-dirty' };
    }

    for (const worktree of occupying.filter((entry) => !entry.isMain)) {
      const action = actions.get(worktree.id);
      if (deleteBranch && action?.mode !== 'full-cleanup') {
        return { ok: false, error: `分支仍由 worktree 使用：${worktree.displayPath}`, code: 'worktree-plan-incomplete' };
      }
    }
    for (const action of plan.worktrees) {
      const worktree = snapshot.worktrees.find((entry) => entry.id === action.id);
      if (!worktree || worktree.isMain) return { ok: false, error: 'worktree 清理計畫已失效。', code: 'state-changed' };
      if (action.mode === 'stale-registration') {
        if (!worktree.prunable || plan.deleteBranch !== false) {
          return { ok: false, error: '只有 prunable worktree 可單獨移除失效登記，且必須保留 branch。', code: 'worktree-plan-incomplete' };
        }
        continue;
      }
      if (worktree.locked && action.mode !== 'list-only' && action.unlock !== true) {
        return { ok: false, error: `worktree 仍受鎖定保護：${worktree.displayPath}`, code: 'worktree-locked' };
      }
      if (action.mode !== 'list-only') {
        if (!request.confirmation.acceptExternalWriteRisk) {
          return { ok: false, error: '尚未確認刪除確認後外部仍可能寫入資料夾的殘餘風險。', code: 'external-write-risk-unconfirmed' };
        }
        if (worktree.dirty !== false && !request.confirmation.forceLocal) {
          return { ok: false, error: `worktree 有未提交、ignored 或無法確認的內容：${worktree.displayPath}`, code: 'worktree-dirty' };
        }
      }
    }
    return null;
  }

  async execute(
    cwd: string,
    journalId: string,
    request: GitCleanupExecuteRequest,
    snapshot: GitCleanupSnapshot,
    options: { alreadyMutating?: boolean; checkpoints?: string[]; remoteTrackingRefsDeleted?: string[]; keepOpen?: boolean } = {},
  ): Promise<GitCleanupExecuteResult> {
    const plan = request.localPlan;
    if (!plan) return { ok: true, journalId, phase: 'prepared' };
    const validation = this.validate(snapshot, request);
    if (validation) return validation;
    const checkpoints = new Set(options.checkpoints ?? []);
    if (!options.alreadyMutating) this.journals.markMutating(journalId);

    try {
      if (plan.switchTo && !checkpoints.has(`switched:${plan.switchTo}`)) {
        const switched = await this.git.write(cwd, ['switch', '--no-guess', plan.switchTo], undefined, true);
        if (switched.code !== 0) throw new Error(switched.stderr.trim() || '切換分支失敗');
        this.journals.checkpoint(journalId, `switched:${plan.switchTo}`);
      }

      for (const action of plan.worktrees) {
        if (checkpoints.has(`worktree-delisted:${action.id}`)
          || checkpoints.has(`worktree-stale-registration-removed:${action.id}`)
          || checkpoints.has(`worktree-removed:${action.id}`)) continue;
        const worktree = snapshot.worktrees.find((entry) => entry.id === action.id);
        if (!worktree) throw new Error('worktree 清理計畫已失效');
        const managed = this.workspaces.list().find((workspace) => canonical(workspace.path) === canonical(worktree.displayPath));
        if (action.mode === 'list-only') {
          if (managed) {
            await this.workspaces.teardownOnly(managed.id);
            this.workspaces.delistOnly(managed.id);
          }
          this.journals.checkpoint(journalId, `worktree-delisted:${action.id}`);
          continue;
        }
        if (action.mode === 'stale-registration') {
          if (managed) await this.workspaces.teardownOnly(managed.id);
          const removed = await this.git.write(cwd, ['worktree', 'remove', '--force', '--force', '--', worktree.displayPath], undefined, true);
          if (removed.code !== 0) throw new Error(removed.stderr.trim() || '移除失效 worktree 登記失敗');
          if (managed) this.workspaces.delistOnly(managed.id);
          this.journals.checkpoint(journalId, `worktree-stale-registration-removed:${action.id}`);
          continue;
        }
        if (worktree.locked && action.unlock) {
          const unlocked = await this.git.write(cwd, ['worktree', 'unlock', '--', worktree.displayPath], undefined, true);
          if (unlocked.code !== 0) throw new Error(unlocked.stderr.trim() || '解除 worktree 鎖定失敗');
          this.journals.checkpoint(journalId, `worktree-unlocked:${action.id}`);
        }
        if (managed) await this.workspaces.teardownOnly(managed.id);
        const forceArgs = worktree.locked && action.unlock ? ['--force', '--force'] : ['--force'];
        const removed = await this.git.write(cwd, ['worktree', 'remove', ...forceArgs, '--', worktree.displayPath], undefined, true);
        if (removed.code !== 0) {
          const reconciled = await this.reconcileWorktree(cwd, journalId, worktree, managed?.id);
          if (reconciled) {
            this.journals.checkpoint(journalId, `worktree-removed:${action.id}`);
            continue;
          }
          throw new Error(removed.stderr.trim() || '刪除 worktree 失敗，已依實際 path/Git/Polydesk 狀態停止或收斂。');
        }
        const reconciled = await this.reconcileWorktree(cwd, journalId, worktree, managed?.id);
        if (!reconciled) throw new Error('Git 回報移除成功，但資料夾仍存在；已保留資料夾並停止清理供人工檢查。');
        this.journals.checkpoint(journalId, `worktree-removed:${action.id}`);
      }

      if (plan.deleteBranch !== false) {
        const commonNow = await this.git.run(cwd, [
          'for-each-ref',
          '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)',
        ], true);
        if (commonNow.code !== 0) throw new Error('無法重驗保留 refs。');
        const retainedNow = parseRefLeases(commonNow.stdout).filter((ref) => ref.ref !== snapshot.target.ref);
        for (const scopePath of snapshot.retainedRefs.privateScopes) {
          const privateNow = await this.git.run(scopePath, [
            'for-each-ref',
            '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)',
            'refs/bisect',
            'refs/worktree',
            'refs/rewritten',
          ], true);
          if (privateNow.code !== 0) throw new Error(`無法重驗 worktree 私有 refs：${scopePath}`);
          retainedNow.push(...parseRefLeases(privateNow.stdout, scopePath));
        }
        sortRefLeases(retainedNow);
        const remotelyDeleted = new Set(options.remoteTrackingRefsDeleted ?? []);
        const expectedRetained = sortRefLeases(snapshot.retainedRefs.refs.filter((ref) => !remotelyDeleted.has(ref.ref)));
        const expectedRetainedDigest = digest({
          refs: expectedRetained,
          privateScopes: [...snapshot.retainedRefs.privateScopes].sort((a, b) => a.localeCompare(b)),
        });
        if (digest({ refs: retainedNow, privateScopes: [...snapshot.retainedRefs.privateScopes].sort((a, b) => a.localeCompare(b)) }) !== expectedRetainedDigest) {
          throw new Error('保留 refs 已變更，必須重新計算風險摘要。');
        }
        if (!checkpoints.has('local-ref-deleted')) {
          const targetNow = await this.git.run(cwd, ['show-ref', '--verify', snapshot.target.ref], true);
          if (targetNow.code === 0) {
            // 保留 refs 逐筆 no-deref：symref（如 refs/remotes/origin/HEAD）預設會被解引用成目標 ref，
            // 與同批的目標本身（refs/remotes/origin/main）撞成同一次更新，整個 transaction 會被 git 擋下。
            const retained = expectedRetained
              .filter((ref) => !ref.scopePath && ref.ref !== snapshot.target.ref && ref.ref !== snapshot.baseline.ref)
              .flatMap((ref) => ['option no-deref', `verify ${ref.ref} ${ref.oid}`]);
            const transaction = [
              'start',
              `verify ${snapshot.baseline.ref} ${snapshot.baseline.oid}`,
              ...retained,
              `delete ${snapshot.target.ref} ${snapshot.target.oid}`,
              'prepare',
              'commit',
              '',
            ].join('\n');
            const deleted = await this.git.write(
              cwd,
              ['update-ref', '--stdin', '-m', `polydesk-cleanup:${journalId}`],
              transaction,
              true,
            );
            if (deleted.code !== 0) throw new Error(deleted.stderr.trim() || '本地 branch lease 已變更');
          }
          this.journals.checkpoint(journalId, 'local-ref-deleted');
        }

        const occupancy = await this.git.run(cwd, ['worktree', 'list', '--porcelain', '-z'], true);
        if (occupancy.code !== 0 || occupancy.stdout.includes(`branch ${snapshot.target.ref}\0`)) {
          const restored = await this.git.write(
            cwd,
            ['update-ref', '--stdin', '-m', `polydesk-cleanup-restore:${journalId}`],
            `start\ncreate ${snapshot.target.ref} ${snapshot.target.oid}\nprepare\ncommit\n`,
            true,
          );
          if (restored.code === 0) this.journals.checkpoint(journalId, 'local-ref-restored-after-worktree-race');
          throw new Error('刪除期間有新的 worktree 簽出目標分支，已嘗試恢復 branch 並凍結清理。');
        }

        const section = `branch.${request.branch}`;
        if (!checkpoints.has('branch-config-cleared') && snapshot.metadata.entries.some((entry) => entry.mutable)) {
          const config = await this.git.write(cwd, ['config', '--local', '--remove-section', section], undefined, true);
          const remains = await this.git.run(cwd, ['config', '--local', '--get-regexp', `^branch\\.${request.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`], true);
          if (config.code !== 0 && remains.code === 0) throw new Error(config.stderr.trim() || '清除 branch config 失敗');
        }
        if (!checkpoints.has('branch-config-cleared')) this.journals.checkpoint(journalId, 'branch-config-cleared');

        if (!checkpoints.has('branch-reflog-cleared')) {
          const reflogExists = await this.git.run(cwd, ['reflog', 'exists', snapshot.target.ref], true);
          if (reflogExists.code === 0) {
            const dropped = await this.git.write(cwd, ['reflog', 'drop', snapshot.target.ref], undefined, true);
            if (dropped.code !== 0) throw new Error(dropped.stderr.trim() || '清除 branch reflog 失敗');
          }
          this.journals.checkpoint(journalId, 'branch-reflog-cleared');
        }

      }
      if (options.keepOpen) return { ok: true, journalId, phase: 'mutating' };
      this.journals.close(journalId);
      return { ok: true, journalId, phase: 'closed' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '本機清理失敗。',
        code: 'local-cleanup-failed',
        journalId,
      };
    }
  }

  /** 決議 059：按 path/Git/Polydesk 八態重查，只做表內允許的 target-scoped 收斂。 */
  private async reconcileWorktree(
    cwd: string,
    journalId: string,
    worktree: GitCleanupSnapshot['worktrees'][number],
    managedWsId?: string,
  ): Promise<boolean> {
    let pathExists = false;
    try {
      lstatSync(worktree.displayPath);
      pathExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('無法確認 worktree 資料夾是否仍存在。');
    }

    const listed = await this.git.run(cwd, ['worktree', 'list', '--porcelain', '-z'], true);
    if (listed.code !== 0) throw new Error('無法重查 Git worktree 登記。');
    let gitRegistered = listed.stdout.split('\0').some((token) =>
      token.startsWith('worktree ') && canonical(token.slice('worktree '.length)) === canonical(worktree.displayPath),
    );
    const polydeskRegistered = managedWsId ? this.workspaces.get(managedWsId) !== undefined : false;
    const action = decideWorktreeReconciliation(pathExists, gitRegistered, polydeskRegistered);

    if (pathExists && gitRegistered) {
      const [candidateCommon, expectedCommon] = await Promise.all([
        this.git.run(worktree.displayPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'], true),
        this.git.run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], true),
      ]);
      if (candidateCommon.code !== 0 || expectedCommon.code !== 0 || canonical(candidateCommon.stdout.trim()) !== canonical(expectedCommon.stdout.trim())) {
        throw new Error('worktree 路徑與 Git 登記仍存在但 lineage 無法證明，已凍結供人工檢查。');
      }
    }

    if (action === 'remove-registration-and-delist' || action === 'remove-registration') {
      const removed = await this.git.write(cwd, ['worktree', 'remove', '--force', '--force', '--', worktree.displayPath], undefined, true);
      if (removed.code !== 0) throw new Error('資料夾已不在，但指定 Git worktree 登記仍無法移除。');
      gitRegistered = false;
      this.journals.checkpoint(journalId, `worktree-registration-reconciled:${worktree.id}`);
    }

    if ((action === 'delist-preserve-path' || action === 'remove-registration-and-delist' || action === 'delist-complete') && managedWsId) {
      this.workspaces.delistOnly(managedWsId);
      this.journals.checkpoint(journalId, `worktree-delisted-after-reconcile:${worktree.id}`);
    }

    // path 仍在而 Git 已不在時必須保留資料夾並轉人工；path/Git 都不在才是完整移除。
    return action === 'remove-registration-and-delist' || action === 'remove-registration' || action === 'delist-complete' || action === 'complete';
  }
}
