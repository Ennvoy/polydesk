export type GitCleanupBlockerCode =
  | 'invalid-branch'
  | 'branch-not-found'
  | 'baseline-unavailable'
  | 'operation-in-progress'
  | 'operation-state-unknown'
  | 'worktree-state-unknown'
  | 'private-refs-unknown'
  | 'object-graph-incomplete'
  | 'reflog-drop-unsupported'
  | 'metadata-origin-unsupported'
  | 'repository-identity-unknown'
  | 'active-cleanup'
  | 'cleanup-store-blocked'
  | 'force-required'
  | 'switch-required'
  | 'switch-target-unavailable'
  | 'worktree-dirty'
  | 'worktree-plan-incomplete'
  | 'worktree-locked'
  | 'external-write-risk-unconfirmed'
  | 'local-cleanup-failed'
  | 'remote-target-unavailable'
  | 'remote-state-unknown'
  | 'remote-cleanup-failed'
  | 'recovery-required'
  | 'state-changed';

export interface GitCleanupBlocker {
  code: GitCleanupBlockerCode;
  message: string;
  worktreeId?: string;
}

export interface GitCleanupRefLease {
  ref: string;
  oid: string;
  objectType?: string;
  symref?: string;
  /** worktree private ref 的查詢根；省略代表 common ref。 */
  scopePath?: string;
}

export interface GitCleanupMetadataEntry {
  scope: string;
  origin: string;
  key: string;
  value: string;
  mutable: boolean;
}

export interface GitCleanupWorktreeSnapshot {
  id: string;
  displayPath: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  prunable: boolean;
  locked: boolean;
  lockReason?: string;
  statusDigest: string | null;
  dirty: boolean | null;
  gitDirDigest: string | null;
  operations: string[];
  privateRefsDigest: string | null;
}

export interface GitCleanupRemoteEndpoint {
  id: string;
  remote: string;
  branch: string;
  ref: string;
  fingerprint: string;
  display: string;
  status: 'exists' | 'unknown';
  expectedOid?: string;
  preselected: boolean;
  reason?: string;
}

export interface GitCleanupRemoteTrackingProducer {
  remote: string;
  sourceRef: string;
  refspec: string;
  endpointIds: string[];
}

export interface GitCleanupRemoteTrackingLease {
  localRef: string;
  expectedOid?: string;
  producers: GitCleanupRemoteTrackingProducer[];
  negativeOrAmbiguous: boolean;
  namespaceAllowed: boolean;
  symrefs: { ref: string; target: string; typical: boolean }[];
  reflogExists: boolean;
  reflogDigest: string;
}

export interface GitCleanupRemotePlan {
  token: string;
  branch: string;
  localTargetRef: string;
  objectGraphComplete: boolean;
  objectGraphReason?: string;
  localIdentityDigest: string;
  localIdentityAfterTargetDeleteDigest: string;
  endpointConfigDigest: string;
  refspecDigest: string;
  conflictDigest: string;
  endpoints: GitCleanupRemoteEndpoint[];
  trackingRefs: GitCleanupRemoteTrackingLease[];
}

export interface GitCleanupRemotePreview {
  plan: GitCleanupRemotePlan;
  selectedEndpointIds: string[];
  requestedTargets: { remote: string; branch: string }[];
  unresolvedTargets: { remote: string; branch: string; reason: string }[];
}

export interface GitCleanupSnapshot {
  repository: {
    fingerprint: string;
    commonDirDigest: string;
    evidenceDigest: string;
  };
  target: GitCleanupRefLease;
  baseline: GitCleanupRefLease;
  retainedRefs: { count: number; digest: string; refs: GitCleanupRefLease[]; privateScopes: string[] };
  worktrees: GitCleanupWorktreeSnapshot[];
  metadata: {
    digest: string;
    entries: GitCleanupMetadataEntry[];
    reflogDigest: string;
    reflogExists: boolean;
  };
  objectGraph: {
    complete: boolean;
    shallow: boolean;
    promisor: boolean;
    missingObjectCount: number;
  };
  localRisk: {
    safeDelete: boolean;
    lostCommitCount: number;
    exact: boolean;
    plannedRemoteTrackingRefs?: string[];
  };
  capabilities: {
    reflogDrop: boolean;
    privateRefs: boolean;
    operationMarkers: boolean;
  };
  switchCandidates: string[];
  blockers: GitCleanupBlocker[];
  remote?: GitCleanupRemotePreview;
}

export interface GitCleanupPreviewRequest {
  wsId: string;
  branch: string;
  switchTo?: string;
  removeWorktreeIds?: string[];
  remoteTargets?: { remote: string; branch: string }[];
}

export type GitCleanupPreviewResult =
  | { ok: true; leaseToken: string; snapshot: GitCleanupSnapshot }
  | { ok: false; error: string; code: GitCleanupBlockerCode };

export interface GitCleanupExecuteRequest {
  wsId: string;
  branch: string;
  leaseToken: string;
  localPlan?: {
    /** false 供 Worktree 分頁只處理列表／資料夾，保留 branch；省略為完整分支清理。 */
    deleteBranch?: boolean;
    switchTo?: string;
    worktrees: {
      id: string;
      mode: 'list-only' | 'delete-folder' | 'full-cleanup' | 'stale-registration';
      unlock?: boolean;
    }[];
  };
  confirmation: {
    forceLocal: boolean;
    acceptExternalWriteRisk: boolean;
    remoteTargets: { remote: string; branch: string }[];
  };
}

export type GitCleanupExecuteResult =
  | { ok: true; journalId: string; phase: 'prepared' | 'mutating' | 'reconciling' | 'closed'; remote?: GitCleanupRemoteExecution }
  | { ok: false; error: string; code: GitCleanupBlockerCode; journalId?: string; currentPreview?: GitCleanupPreviewResult; remote?: GitCleanupRemoteExecution };

export interface GitCleanupRemoteExecution {
  ok: boolean;
  endpoints: {
    id: string;
    fingerprint: string;
    remote: string;
    branch: string;
    status: 'deleted' | 'already-completed' | 'stale' | 'unknown' | 'skipped';
    message?: string;
  }[];
  trackingRefsDeleted: string[];
  trackingRefsRetained: { localRef: string; reason: string }[];
}

export interface GitCleanupJournalSummary {
  journalId: string;
  repositoryFingerprint?: string;
  phase: 'prepared' | 'mutating' | 'reconciling' | 'quarantine';
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  wsId?: string;
  branch?: string;
  canCancel: boolean;
  canResume: boolean;
  checkpoints: string[];
  requiresEvidence?: boolean;
  issue?: string;
}

export interface GitCleanupStatusResult {
  globalBlocked: boolean;
  journals: GitCleanupJournalSummary[];
  issues: { code: string; message: string; file?: string }[];
}

export interface GitCleanupResumeRequest {
  wsId: string;
  journalId: string;
}

export interface GitCleanupImportEvidenceRequest {
  wsId: string;
  journalId: string;
  /** 先前備份、且必須與 envelope checksum 完全相符的原始 journal payload JSON。 */
  payloadJson: string;
}
