import { resolve } from 'node:path';
import type {
  GitCleanupExecuteRequest,
  GitCleanupExecuteResult,
  GitCleanupJournalSummary,
  GitCleanupPreviewRequest,
  GitCleanupPreviewResult,
  GitCleanupSnapshot,
  GitCleanupResumeRequest,
  GitCleanupImportEvidenceRequest,
  GitCleanupStatusResult,
} from '../../../../shared/gitCleanup';
import type { WorkspaceManager } from '../../../workspace/WorkspaceManager';
import { CleanupJournalStore, CleanupStoreError } from '../../../store/cleanup/CleanupJournalStore';
import { CleanupPreviewService } from './CleanupPreview';
import { LocalCleanupExecutor } from '../local/LocalCleanupExecutor';
import { RemoteCleanupService } from '../remote/RemoteCleanupService';
import { digest, sha256 } from './hash';
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

function canonicalPath(path: string): string {
  const canonical = resolve(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function comparableSnapshot(snapshot: GitCleanupSnapshot): unknown {
  if (!snapshot.remote) return snapshot;
  const { token: _token, ...plan } = snapshot.remote.plan;
  return {
    ...snapshot,
    remote: { ...snapshot.remote, plan },
  };
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

  async preview(request: GitCleanupPreviewRequest, ownClaimId?: string): Promise<GitCleanupPreviewResult> {
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
      const plan = await this.remote.discover(workspace.path, branches[0] as string, request.branch, ownClaimId);
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
      if (active.claims.some((claim) => claim.repositoryGeneration === identity.generation)) {
        return { ok: false, error: '此 repository 已有未完成的本機清理。', code: 'active-cleanup' };
      }
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
      let payload = rawPayload;
      const commonDir = await this.previewService.resolveCommonDir(request.wsId);
      if (!commonDir) throw new CleanupStoreError('repository-identity-unknown', '無法確認 repository 身分。');
      const identity = this.journals.resolveRepositoryIdentity(commonDir, payload.preview.snapshot.repository.evidenceDigest);
      if (identity.generation !== envelope.repositoryGeneration) {
        throw new CleanupStoreError('repository-generation-changed', '目前路徑已不是建立 journal 時的 repository 實例，拒絕恢復清理。');
      }
      if (identity.fingerprint !== envelope.repositoryFingerprint || payload.request.wsId !== request.wsId) {
        payload = await this.rebindPayload(payload, request.wsId, workspace.path, commonDir, identity.fingerprint);
        this.journals.rebindActiveJournal({
          journalId: request.journalId,
          repositoryFingerprint: identity.fingerprint,
          repositoryGeneration: identity.generation,
          payload,
        });
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
    let reboundIdentity: { fingerprint: string; generation: string } | undefined;
    try {
      const verified = this.journals.readVerifiedActive(journalId);
      if (!isCleanupJournalPayload(verified.payload)) {
        throw new CleanupStoreError('invalid-payload', '清理 journal payload 欄位不完整。');
      }
      payload = verified.payload;
      const commonDir = await this.previewService.resolveCommonDir(wsId);
      if (!commonDir) throw new CleanupStoreError('repository-identity-unknown', '無法確認 repository 身分。');
      const identity = this.journals.resolveRepositoryIdentity(commonDir, payload.preview.snapshot.repository.evidenceDigest);
      if (identity.generation !== verified.envelope.repositoryGeneration) {
        throw new CleanupStoreError('repository-generation-changed', '清理 journal 不屬於目前的 repository 實例。');
      }
      if (identity.fingerprint !== verified.envelope.repositoryFingerprint || payload.request.wsId !== wsId) {
        payload = await this.rebindPayload(payload, wsId, workspace.path, commonDir, identity.fingerprint, true);
        reboundIdentity = identity;
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '找不到清理 journal。' };
    }
    const current = await this.preview(this.previewRequest(payload, wsId), journalId);
    if (!current.ok) {
      return { ok: false, error: 'pre-state 已變更，無法證明這份 prepared 計畫仍為零副作用。' };
    }
    if (reboundIdentity) {
      if (digest(comparableSnapshot(current.snapshot)) !== digest(comparableSnapshot(payload.preview.snapshot))) {
        return { ok: false, error: 'pre-state 已變更，無法證明這份 prepared 計畫仍為零副作用。' };
      }
      payload = { ...payload, leaseToken: current.leaseToken, preview: current };
      try {
        this.journals.rebindActiveJournal({
          journalId,
          repositoryFingerprint: reboundIdentity.fingerprint,
          repositoryGeneration: reboundIdentity.generation,
          payload,
        });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '無法更新搬移後的清理 journal。' };
      }
    } else if (current.leaseToken !== payload.leaseToken) {
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
      if (!isCleanupJournalPayload(parsed)) {
        throw new CleanupStoreError('invalid-payload', '匯入證據不是完整的清理 journal payload。');
      }
      let payload = parsed;
      const envelope = this.journals.readQuarantineEnvelope(request.journalId);
      const commonDir = await this.previewService.resolveCommonDir(request.wsId);
      if (!commonDir) throw new CleanupStoreError('repository-identity-unknown', '無法確認 repository 身分。');
      const identity = this.journals.resolveRepositoryIdentity(commonDir, payload.preview.snapshot.repository.evidenceDigest);
      if (identity.generation !== envelope.repositoryGeneration) {
        throw new CleanupStoreError('repository-generation-changed', '證據不屬於目前的 repository 實例。');
      }
      this.journals.restoreQuarantinedPayload(request.journalId, payload);
      if (identity.fingerprint !== envelope.repositoryFingerprint || payload.request.wsId !== request.wsId) {
        payload = await this.rebindPayload(payload, request.wsId, workspace.path, commonDir, identity.fingerprint);
        this.journals.rebindActiveJournal({
          journalId: request.journalId,
          repositoryFingerprint: identity.fingerprint,
          repositoryGeneration: identity.generation,
          payload,
        });
      }
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
        const verified = this.journals.readVerifiedActive(claim.journalId);
        if (!isCleanupJournalPayload(verified.payload)) continue;
        const payload = verified.payload;
        if (payload.checkpoints.length > 0) continue;
        const current = await this.preview(this.previewRequest(payload, payload.request.wsId));
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
    let repositoryGenerations: string[] = [];
    try {
      repositoryGenerations = this.journals.repositoryGenerations(commonDir);
    } catch {
      repositoryGenerations = [];
    }
    const generations = new Set(repositoryGenerations);
    const generationJournalIds = new Set(this.journals.peek().claims
      .filter((claim) => generations.has(claim.repositoryGeneration))
      .map((claim) => claim.journalId));
    return {
      ...result,
      journals: result.journals.filter((journal) =>
        journal.wsId === wsId
        || journal.repositoryFingerprint === fingerprint
        || generationJournalIds.has(journal.journalId),
      ),
    };
  }

  private previewRequest(payload: CleanupJournalPayload, wsId: string): GitCleanupPreviewRequest {
    return {
      wsId,
      branch: payload.request.branch,
      ...(payload.request.localPlan?.switchTo ? { switchTo: payload.request.localPlan.switchTo } : {}),
      ...(payload.request.localPlan ? {
        removeWorktreeIds: payload.request.localPlan.worktrees
          .filter((action) => action.mode !== 'list-only')
          .map((action) => action.id),
      } : {}),
      remoteTargets: payload.request.confirmation.remoteTargets,
    };
  }

  private async rebindPayload(
    payload: CleanupJournalPayload,
    wsId: string,
    workspacePath: string,
    commonDir: string,
    repositoryFingerprint: string,
    updateWorktreeIds = false,
  ): Promise<CleanupJournalPayload> {
    const listed = await this.git.run(workspacePath, ['worktree', 'list', '--porcelain', '-z'], true);
    const mainToken = listed.stdout.split('\0').find((token) => token.startsWith('worktree '));
    const oldMain = payload.preview.snapshot.worktrees.find((worktree) => worktree.isMain);
    if (listed.code !== 0 || !mainToken || !oldMain) {
      throw new CleanupStoreError('repository-identity-unknown', '無法確認搬移後的主工作樹路徑。');
    }
    const mainPath = mainToken.slice('worktree '.length);
    const gitDir = await this.git.run(mainPath, ['rev-parse', '--path-format=absolute', '--git-dir'], true);
    if (gitDir.code !== 0 || !gitDir.stdout.trim()) {
      throw new CleanupStoreError('repository-identity-unknown', '無法確認搬移後的主工作樹 Git 目錄。');
    }
    const remapMainPath = (path: string): string =>
      canonicalPath(path) === canonicalPath(oldMain.displayPath) ? mainPath : path;
    const refs = payload.preview.snapshot.retainedRefs.refs.map((ref) =>
      ref.scopePath ? { ...ref, scopePath: remapMainPath(ref.scopePath) } : ref,
    ).sort((a, b) =>
      (a.scopePath ?? '').localeCompare(b.scopePath ?? '')
      || a.ref.localeCompare(b.ref)
      || a.oid.localeCompare(b.oid),
    );
    const privateScopes = payload.preview.snapshot.retainedRefs.privateScopes.map(remapMainPath)
      .sort((a, b) => a.localeCompare(b));
    const retainedRefs = {
      count: refs.length,
      refs,
      privateScopes,
      digest: digest({ refs, privateScopes }),
    };
    const reboundWorktreeIds = new Map<string, string>();
    const worktrees = payload.preview.snapshot.worktrees.map((worktree) => {
      const displayPath = worktree.isMain ? mainPath : worktree.displayPath;
      const id = updateWorktreeIds ? sha256(`${repositoryFingerprint}\0${displayPath}`) : worktree.id;
      reboundWorktreeIds.set(worktree.id, id);
      return worktree.isMain
        ? { ...worktree, id, displayPath, gitDirDigest: sha256(resolve(gitDir.stdout.trim())) }
        : { ...worktree, id };
    });
    const snapshot = {
      ...payload.preview.snapshot,
      repository: {
        ...payload.preview.snapshot.repository,
        fingerprint: repositoryFingerprint,
        commonDirDigest: sha256(resolve(commonDir)),
      },
      retainedRefs,
      worktrees,
    };
    const request = {
      ...payload.request,
      wsId,
      ...(payload.request.localPlan ? {
        localPlan: {
          ...payload.request.localPlan,
          worktrees: payload.request.localPlan.worktrees.map((action) => ({
            ...action,
            id: reboundWorktreeIds.get(action.id) ?? action.id,
          })),
        },
      } : {}),
    };
    return {
      ...payload,
      request,
      preview: { ...payload.preview, snapshot },
    };
  }

}
