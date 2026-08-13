import type {
  GitCleanupExecuteRequest,
  GitCleanupExecuteResult,
  GitCleanupJournalSummary,
  GitCleanupPreviewRequest,
  GitCleanupPreviewResult,
  GitCleanupResumeRequest,
  GitCleanupImportEvidenceRequest,
  GitCleanupStatusResult,
} from '../../../../shared/gitCleanup';
import type { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import { CleanupJournalStore, CleanupStoreError } from '../../../store/cleanup/CleanupJournalStore';
import { CleanupPreviewService } from './CleanupPreview';
import { LocalCleanupExecutor } from '../local/LocalCleanupExecutor';
import { RemoteCleanupService } from '../remote/RemoteCleanupService';
import { digest } from './hash';
import { CleanupGitRunner } from './CleanupGitRunner';

interface CleanupJournalPayload {
  schemaVersion: 1;
  leaseToken: string;
  request: GitCleanupExecuteRequest;
  preview: Extract<GitCleanupPreviewResult, { ok: true }>;
  checkpoints: string[];
}

function isCleanupJournalPayload(value: unknown): value is CleanupJournalPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CleanupJournalPayload>;
  return candidate.schemaVersion === 1
    && typeof candidate.leaseToken === 'string'
    && Boolean(candidate.request && typeof candidate.request.wsId === 'string')
    && candidate.preview?.ok === true
    && Array.isArray(candidate.checkpoints);
}

export class CleanupService {
  private readonly previewService: CleanupPreviewService;
  private readonly journals: CleanupJournalStore;
  private readonly local: LocalCleanupExecutor;
  private readonly remote: RemoteCleanupService;
  private readonly git = new CleanupGitRunner();

  constructor(
    private readonly workspaces: WorkspaceManager,
    userDataDir: string,
  ) {
    this.previewService = new CleanupPreviewService(workspaces);
    this.journals = new CleanupJournalStore(userDataDir);
    // 啟動時先完成一次 claim 重建／quarantine；後續狀態輪詢只讀既有索引。
    this.journals.rebuildClaims();
    this.local = new LocalCleanupExecutor(workspaces, this.journals);
    this.remote = new RemoteCleanupService({
      snapshot: async (_cwd, ownClaimId) => {
        const state = this.journals.peek();
        return digest({
          globalBlocked: state.globalBlocked,
          claims: state.claims
            .filter((claim) => claim.journalId !== ownClaimId)
            .map((claim) => ({
              journalId: claim.journalId,
              repositoryFingerprint: claim.repositoryFingerprint,
              phase: claim.phase,
            })),
          issues: state.issues,
        });
      },
    });
  }

  async preview(request: GitCleanupPreviewRequest): Promise<GitCleanupPreviewResult> {
    const localPreview = await this.previewService.preview(request);
    if (!localPreview.ok || !request.remoteTargets?.length) return localPreview;
    const workspace = this.workspaces.get(request.wsId);
    if (!workspace) return { ok: false, error: '找不到工作區。', code: 'repository-identity-unknown' };
    const requestedTargets = [...new Map(request.remoteTargets.map((target) => [
      `${target.remote}\0${target.branch}`,
      target,
    ])).values()];
    const branches = [...new Set(requestedTargets.map((target) => target.branch))];
    if (branches.length !== 1) {
      return { ok: false, error: '一次清理只能處理同一個遠端 branch 名稱。', code: 'remote-target-unavailable' };
    }
    try {
      const plan = await this.remote.discover(workspace.path, branches[0] as string, request.branch);
      const selectedEndpointIds = plan.endpoints
        .filter((endpoint) => requestedTargets.some((target) =>
          target.remote === endpoint.remote && target.branch === endpoint.branch,
        ))
        .map((endpoint) => endpoint.id);
      const unresolvedTargets = requestedTargets.flatMap((target) =>
        plan.endpoints.some((endpoint) => endpoint.remote === target.remote && endpoint.branch === target.branch)
          ? []
          : [{ ...target, reason: '找不到可驗證的 effective push endpoint。' }],
      );
      const remote = { plan, selectedEndpointIds, requestedTargets, unresolvedTargets };
      const selected = new Set(selectedEndpointIds);
      const plannedRemoteTrackingRefs = plan.trackingRefs.filter((lease) =>
        lease.namespaceAllowed
        && !lease.negativeOrAmbiguous
        && Boolean(lease.expectedOid)
        && lease.symrefs.every((symref) => symref.typical)
        && lease.producers.length > 0
        && lease.producers.every((producer) => producer.endpointIds.length > 0
          && producer.endpointIds.every((endpointId) => selected.has(endpointId))),
      ).map((lease) => lease.localRef).sort((a, b) => a.localeCompare(b));
      const excluded = new Set(plannedRemoteTrackingRefs);
      const riskRetained = localPreview.snapshot.retainedRefs.refs.filter((ref) => !excluded.has(ref.ref));
      const lostCount = await this.git.run(workspace.path, [
        'rev-list',
        '--count',
        localPreview.snapshot.target.oid,
        ...(riskRetained.length > 0 ? ['--not', ...riskRetained.map((ref) => ref.oid)] : []),
      ], true);
      if (lostCount.code !== 0) {
        return { ok: false, error: '無法計算完成本機與遠端清理後的 commit 風險。', code: 'remote-state-unknown' };
      }
      const localRisk = {
        ...localPreview.snapshot.localRisk,
        lostCommitCount: Number.parseInt(lostCount.stdout.trim(), 10) || 0,
        plannedRemoteTrackingRefs,
      };
      const { token: _token, ...stablePlan } = plan;
      const snapshot = { ...localPreview.snapshot, localRisk, remote };
      return {
        ok: true,
        snapshot,
        leaseToken: digest({ local: localPreview.leaseToken, remote: stablePlan, selectedEndpointIds, unresolvedTargets }),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '無法確認遠端狀態。',
        code: 'remote-state-unknown',
      };
    }
  }

  async execute(request: GitCleanupExecuteRequest): Promise<GitCleanupExecuteResult> {
    const active = this.journals.rebuildClaims();
    if (active.globalBlocked) {
      return { ok: false, error: '清理儲存區有無法驗證的狀態，已暫停新的破壞性清理。', code: 'cleanup-store-blocked' };
    }
    const workspace = this.workspaces.get(request.wsId);
    if (!workspace) return { ok: false, error: '找不到工作區。', code: 'repository-identity-unknown' };
    const currentPreview = await this.preview({
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
    const remotePreview = currentPreview.snapshot.remote;
    if (remotePreview?.unresolvedTargets.length) {
      return { ok: false, error: remotePreview.unresolvedTargets[0]?.reason ?? '遠端目標無法解析。', code: 'remote-target-unavailable' };
    }
    if (remotePreview && !remotePreview.plan.objectGraphComplete) {
      return { ok: false, error: remotePreview.plan.objectGraphReason ?? 'repository 歷史不完整，已停用遠端完整清理。', code: 'remote-state-unknown' };
    }
    if (remotePreview?.plan.endpoints.some((endpoint) =>
      remotePreview.selectedEndpointIds.includes(endpoint.id) && (endpoint.status !== 'exists' || !endpoint.expectedOid),
    )) {
      return { ok: false, error: '至少一個遠端 endpoint 無法證明精確 ref 與 tip，未開始清理。', code: 'remote-state-unknown' };
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
      return this.runPrepared(workspace.path, journal.journalId, payload);
    } catch (error) {
      if (error instanceof CleanupStoreError) {
        const code = error.code === 'active-cleanup' ? 'active-cleanup' : 'cleanup-store-blocked';
        return { ok: false, error: error.message, code };
      }
      return { ok: false, error: error instanceof Error ? error.message : '無法建立清理 journal。', code: 'cleanup-store-blocked' };
    }
  }

  async resume(request: GitCleanupResumeRequest): Promise<GitCleanupExecuteResult> {
    const workspace = this.workspaces.get(request.wsId);
    if (!workspace) return { ok: false, error: '找不到工作區。', code: 'repository-identity-unknown' };
    try {
      const { envelope, payload: rawPayload } = this.journals.readVerifiedActive(request.journalId);
      if (!isCleanupJournalPayload(rawPayload)) {
        throw new CleanupStoreError('invalid-payload', '清理 journal payload 欄位不完整。');
      }
      const payload = rawPayload;
      if (payload.request.wsId !== request.wsId) {
        return { ok: false, error: '清理 journal 不屬於目前工作區。', code: 'recovery-required', journalId: request.journalId };
      }
      const commonDir = await this.previewService.resolveCommonDir(request.wsId);
      if (!commonDir) throw new CleanupStoreError('repository-identity-unknown', '無法確認 repository 身分。');
      const identity = this.journals.resolveRepositoryIdentity(commonDir, payload.preview.snapshot.repository.evidenceDigest);
      if (identity.fingerprint !== envelope.repositoryFingerprint || identity.generation !== envelope.repositoryGeneration) {
        throw new CleanupStoreError('repository-generation-changed', '目前路徑已不是建立 journal 時的 repository 實例，拒絕恢復清理。');
      }
      this.journals.markReconciling(request.journalId);
      return this.runPrepared(workspace.path, request.journalId, payload, true);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '無法恢復清理 journal。',
        code: 'recovery-required',
        journalId: request.journalId,
      };
    }
  }

  private async runPrepared(
    cwd: string,
    journalId: string,
    payload: CleanupJournalPayload,
    resuming = false,
  ): Promise<GitCleanupExecuteResult> {
    const remotePreview = payload.preview.snapshot.remote;
    const hasRemote = Boolean(remotePreview && remotePreview.selectedEndpointIds.length > 0);
    const completedTrackingRefs = payload.checkpoints
      .filter((checkpoint) => checkpoint.startsWith('remote:tracking-deleted:'))
      .map((checkpoint) => checkpoint.slice('remote:tracking-deleted:'.length));
    let localResult: GitCleanupExecuteResult | undefined;
    if (payload.request.localPlan) {
      localResult = await this.local.execute(
        cwd,
        journalId,
        payload.request,
        payload.preview.snapshot,
        {
          alreadyMutating: resuming,
          checkpoints: payload.checkpoints,
          remoteTrackingRefsDeleted: completedTrackingRefs,
          keepOpen: hasRemote,
        },
      );
      if (!localResult.ok) return localResult;
    }
    let remoteResult;
    if (hasRemote && remotePreview) {
      if (resuming) await this.remote.resume(cwd, remotePreview.plan);
      else if (!payload.request.localPlan) this.journals.markMutating(journalId);
      const completedEndpointIds = payload.checkpoints
        .filter((checkpoint) => checkpoint.startsWith('remote:endpoint-deleted:'))
        .map((checkpoint) => checkpoint.slice('remote:endpoint-deleted:'.length));
      const permanentlyRetainedTrackingRefs = payload.checkpoints
        .filter((checkpoint) => checkpoint.startsWith('remote:tracking-retained:'))
        .map((checkpoint) => checkpoint.slice('remote:tracking-retained:'.length).split('\0', 1)[0] as string);
      remoteResult = await this.remote.execute(cwd, {
        token: remotePreview.plan.token,
        selectedEndpointIds: remotePreview.selectedEndpointIds,
        completedEndpointIds,
        completedTrackingRefs,
        permanentlyRetainedTrackingRefs,
        ownClaimId: journalId,
      }, {
        checkpoint: (checkpoint) => {
          if (checkpoint.kind === 'endpoint-deleted') {
            this.journals.checkpoint(journalId, `remote:endpoint-deleted:${checkpoint.endpointId}`);
          } else if (checkpoint.kind === 'tracking-deleted') {
            this.journals.checkpoint(journalId, `remote:tracking-deleted:${checkpoint.localRef}`);
          } else {
            this.journals.checkpoint(journalId, `remote:tracking-retained:${checkpoint.localRef}\0${checkpoint.reason}`);
          }
        },
      });
      if (!remoteResult.ok) {
        return {
          ok: false,
          error: '遠端清理只有部分完成或狀態未知；journal 已保留，可在 SCM 待辦繼續收斂。',
          code: 'remote-cleanup-failed',
          journalId,
          remote: remoteResult,
        };
      }
    }
    if (hasRemote) {
      this.journals.close(journalId);
      return { ok: true, journalId, phase: 'closed', remote: remoteResult };
    }
    if (localResult) return localResult;
    return { ok: true, journalId, phase: 'prepared' };
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
    const current = await this.preview({
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

  async importEvidence(request: GitCleanupImportEvidenceRequest): Promise<{ ok: true } | { ok: false; error: string }> {
    const workspace = this.workspaces.get(request.wsId);
    if (!workspace) return { ok: false, error: '找不到工作區。' };
    try {
      const parsed = JSON.parse(request.payloadJson) as unknown;
      if (!isCleanupJournalPayload(parsed) || parsed.request.wsId !== request.wsId) {
        throw new CleanupStoreError('invalid-payload', '匯入證據不是完整的清理 journal payload。');
      }
      const payload = parsed;
      const envelope = this.journals.readQuarantineEnvelope(request.journalId);
      const commonDir = await this.previewService.resolveCommonDir(request.wsId);
      if (!commonDir) throw new CleanupStoreError('repository-identity-unknown', '無法確認 repository 身分。');
      const identity = this.journals.resolveRepositoryIdentity(commonDir, payload.preview.snapshot.repository.evidenceDigest);
      if (identity.fingerprint !== envelope.repositoryFingerprint || identity.generation !== envelope.repositoryGeneration) {
        throw new CleanupStoreError('repository-generation-changed', '證據不屬於目前的 repository 實例。');
      }
      this.journals.restoreQuarantinedPayload(request.journalId, payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '無法匯入清理證據。' };
    }
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
        const current = await this.preview({
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
    const state = this.journals.peek();
    const now = new Date().toISOString();
    const journals: GitCleanupJournalSummary[] = state.claims.map((claim) => {
      let payload: CleanupJournalPayload | undefined;
      try {
        const candidate = this.journals.readPayload(claim.journalId);
        payload = isCleanupJournalPayload(candidate) ? candidate : undefined;
      } catch {
        payload = undefined;
      }
      return {
        journalId: claim.journalId,
        repositoryFingerprint: claim.repositoryFingerprint,
        phase: claim.phase,
        createdAt: now,
        updatedAt: now,
        archived: false,
        wsId: payload?.request.wsId,
        branch: payload?.request.localPlan
          ? payload.request.branch
          : (payload?.preview.snapshot.remote?.plan.branch ?? payload?.request.branch),
        canCancel: claim.phase === 'prepared',
        canResume: claim.phase === 'mutating' || claim.phase === 'reconciling',
        checkpoints: payload?.checkpoints ?? [],
        requiresEvidence: claim.phase === 'quarantine',
        issue: claim.phase === 'quarantine' ? 'journal payload 驗證失敗；必須匯入 checksum 相符的原始證據才能繼續。' : undefined,
      };
    });
    return { globalBlocked: state.globalBlocked, journals, issues: state.issues };
  }

  async statusForWorkspace(wsId?: string): Promise<GitCleanupStatusResult> {
    const result = this.status();
    if (!wsId) return result;
    const commonDir = await this.previewService.resolveCommonDir(wsId);
    if (!commonDir) return { ...result, journals: result.journals.filter((journal) => journal.wsId === wsId) };
    const fingerprint = this.journals.repositoryFingerprint(commonDir);
    return {
      ...result,
      journals: result.journals.filter((journal) => journal.wsId === wsId || journal.repositoryFingerprint === fingerprint),
    };
  }

}
