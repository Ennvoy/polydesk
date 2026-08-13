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
  | 'state-changed';

export interface GitCleanupBlocker {
  code: GitCleanupBlockerCode;
  message: string;
  worktreeId?: string;
}

export interface GitCleanupRefLease {
  ref: string;
  oid: string;
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
  gitDirDigest: string | null;
  operations: string[];
  privateRefsDigest: string | null;
}

export interface GitCleanupSnapshot {
  repository: {
    fingerprint: string;
    commonDirDigest: string;
    evidenceDigest: string;
  };
  target: GitCleanupRefLease;
  baseline: GitCleanupRefLease;
  retainedRefs: { count: number; digest: string; refs: GitCleanupRefLease[] };
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
  capabilities: {
    reflogDrop: boolean;
    privateRefs: boolean;
    operationMarkers: boolean;
  };
  switchCandidates: string[];
  blockers: GitCleanupBlocker[];
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
  confirmation: {
    forceLocal: boolean;
    acceptExternalWriteRisk: boolean;
    remoteTargets: { remote: string; branch: string }[];
  };
}

export type GitCleanupExecuteResult =
  | { ok: true; journalId: string; phase: 'prepared' | 'mutating' | 'reconciling' | 'closed' }
  | { ok: false; error: string; code: GitCleanupBlockerCode; currentPreview?: GitCleanupPreviewResult };

export interface GitCleanupJournalSummary {
  journalId: string;
  repositoryFingerprint?: string;
  phase: 'prepared' | 'mutating' | 'reconciling' | 'quarantine';
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface GitCleanupStatusResult {
  globalBlocked: boolean;
  journals: GitCleanupJournalSummary[];
  issues: { code: string; message: string; file?: string }[];
}
