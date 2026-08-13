import type {
  GitCleanupExecuteRequest,
  GitCleanupExecuteResult,
  GitCleanupJournalSummary,
  GitCleanupPreviewRequest,
  GitCleanupPreviewResult,
  GitCleanupStatusResult,
} from '../../../../shared/gitCleanup';
import type { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import { CleanupJournalStore, CleanupStoreError } from '../../../store/cleanup/CleanupJournalStore';
import { CleanupPreviewService } from './CleanupPreview';
import { LocalCleanupExecutor } from '../local/LocalCleanupExecutor';

interface CleanupJournalPayload {
  schemaVersion: 1;
  leaseToken: string;
  request: GitCleanupExecuteRequest;
  preview: Extract<GitCleanupPreviewResult, { ok: true }>;
  checkpoints: string[];
}

export class CleanupService {
  private readonly previewService: CleanupPreviewService;
  private readonly journals: CleanupJournalStore;
  private readonly local: LocalCleanupExecutor;

  constructor(
    private readonly workspaces: WorkspaceManager,
    userDataDir: string,
  ) {
    this.previewService = new CleanupPreviewService(workspaces);
    this.journals = new CleanupJournalStore(userDataDir);
    this.local = new LocalCleanupExecutor(workspaces, this.journals);
  }

  preview(request: GitCleanupPreviewRequest): Promise<GitCleanupPreviewResult> {
    return this.previewService.preview(request);
  }

  async execute(request: GitCleanupExecuteRequest): Promise<GitCleanupExecuteResult> {
    const active = this.journals.rebuildClaims();
    if (active.globalBlocked) {
      return { ok: false, error: '清理儲存區有無法驗證的狀態，已暫停新的破壞性清理。', code: 'cleanup-store-blocked' };
    }
    const workspace = this.workspaces.get(request.wsId);
    if (!workspace) return { ok: false, error: '找不到工作區。', code: 'repository-identity-unknown' };
    const currentPreview = await this.previewService.preview({
      wsId: request.wsId,
      branch: request.branch,
      switchTo: request.localPlan?.switchTo,
      removeWorktreeIds: request.localPlan?.worktrees
        .filter((action) => action.mode !== 'list-only')
        .map((action) => action.id),
      remoteTargets: request.confirmation.remoteTargets,
    });
    if (currentPreview.ok && active.claims.some((claim) => claim.repositoryFingerprint === currentPreview.snapshot.repository.fingerprint)) {
      return { ok: false, error: '此 repository 已有未完成的本機清理。', code: 'active-cleanup' };
    }
    if (!currentPreview.ok || currentPreview.leaseToken !== request.leaseToken) {
      return { ok: false, error: 'Git 或磁碟狀態已變更，請重新確認風險摘要。', code: 'state-changed', currentPreview };
    }
    const localValidation = this.local.validate(currentPreview.snapshot, request);
    if (localValidation) return localValidation;
    try {
      const commonDir = await this.previewService.resolveCommonDir(request.wsId);
      if (!commonDir) return { ok: false, error: '無法確認 repository 身分。', code: 'repository-identity-unknown' };
      const identity = this.journals.resolveRepositoryIdentity(commonDir, currentPreview.snapshot.repository.evidenceDigest);
      const payload: CleanupJournalPayload = {
        schemaVersion: 1,
        leaseToken: currentPreview.leaseToken,
        request,
        preview: currentPreview,
        checkpoints: [],
      };
      const journal = this.journals.createPrepared({
        repositoryFingerprint: identity.fingerprint,
        repositoryGeneration: identity.generation,
        payload,
      });
      return this.local.execute(workspace.path, journal.journalId, request, currentPreview.snapshot);
    } catch (error) {
      if (error instanceof CleanupStoreError) {
        const code = error.code === 'active-cleanup' ? 'active-cleanup' : 'cleanup-store-blocked';
        return { ok: false, error: error.message, code };
      }
      return { ok: false, error: error instanceof Error ? error.message : '無法建立清理 journal。', code: 'cleanup-store-blocked' };
    }
  }

  async cancelPrepared(wsId: string, journalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const workspace = this.workspaces.get(wsId);
    if (!workspace) return { ok: false, error: '找不到工作區。' };
    let payload: CleanupJournalPayload;
    try {
      payload = this.journals.readPayload(journalId) as CleanupJournalPayload;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '找不到清理 journal。' };
    }
    const current = await this.previewService.preview({
      wsId,
      branch: payload.request.branch,
      remoteTargets: payload.request.confirmation.remoteTargets,
    });
    if (!current.ok || current.leaseToken !== payload.leaseToken) {
      return { ok: false, error: 'pre-state 已變更，無法證明這份 prepared 計畫仍為零副作用。' };
    }
    return this.journals.cancelPrepared(journalId)
      ? { ok: true }
      : { ok: false, error: '這份計畫已進入 mutating，不能取消。' };
  }

  markMutating(journalId: string): void {
    this.journals.markMutating(journalId);
  }

  checkpoint(journalId: string, checkpoint: string): void {
    this.journals.checkpoint(journalId, checkpoint);
  }

  async recoverLocal(): Promise<GitCleanupStatusResult> {
    const before = this.journals.list();
    for (const claim of before.claims) {
      if (claim.phase !== 'mutating') continue;
      try {
        const payload = this.journals.readPayload(claim.journalId) as CleanupJournalPayload;
        if (payload.checkpoints.length > 0) continue;
        const current = await this.previewService.preview({
          wsId: payload.request.wsId,
          branch: payload.request.branch,
          remoteTargets: payload.request.confirmation.remoteTargets,
        });
        if (current.ok && current.leaseToken === payload.leaseToken) {
          this.journals.downgradeMutatingToPrepared(claim.journalId);
        }
      } catch {
        // 無法證明完整 pre-state 時維持 mutating；不得靠 phase 或局部狀態猜測。
      }
    }
    return this.status();
  }

  status(): GitCleanupStatusResult {
    const state = this.journals.list();
    const now = new Date().toISOString();
    const journals: GitCleanupJournalSummary[] = state.claims.map((claim) => ({
      journalId: claim.journalId,
      repositoryFingerprint: claim.repositoryFingerprint,
      phase: claim.phase,
      createdAt: now,
      updatedAt: now,
      archived: false,
    }));
    return { globalBlocked: state.globalBlocked, journals, issues: state.issues };
  }

}
