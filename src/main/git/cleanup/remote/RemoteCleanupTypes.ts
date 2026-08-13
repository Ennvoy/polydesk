export type RemoteEndpointStatus = 'exists' | 'unknown';

export interface RemoteEndpointLease {
  id: string;
  remote: string;
  branch: string;
  ref: string;
  fingerprint: string;
  display: string;
  status: RemoteEndpointStatus;
  expectedOid?: string;
  preselected: boolean;
  reason?: string;
}

export interface RemoteTrackingProducer {
  remote: string;
  sourceRef: string;
  refspec: string;
  endpointIds: string[];
}

export interface RemoteTrackingSymrefLease {
  ref: string;
  target: string;
  typical: boolean;
}

export interface RemoteTrackingLease {
  localRef: string;
  expectedOid?: string;
  producers: RemoteTrackingProducer[];
  negativeOrAmbiguous: boolean;
  namespaceAllowed: boolean;
  symrefs: RemoteTrackingSymrefLease[];
  reflogExists: boolean;
  reflogDigest: string;
}

export interface RemoteCleanupPlan {
  token: string;
  branch: string;
  objectGraphComplete: boolean;
  objectGraphReason?: string;
  localIdentityDigest: string;
  endpointConfigDigest: string;
  refspecDigest: string;
  conflictDigest: string;
  endpoints: RemoteEndpointLease[];
  trackingRefs: RemoteTrackingLease[];
}

export interface RemoteLeaseGuard {
  /** 回傳 active/quarantine journal 與 receipt 衝突集合的 canonical digest；ownClaimId 必須排除自身。 */
  snapshot(cwd: string, ownClaimId?: string): Promise<string>;
}

export type RemoteCleanupCheckpoint =
  | { kind: 'endpoint-deleted'; endpointId: string; branch: string }
  | { kind: 'tracking-deleted'; localRef: string }
  | { kind: 'tracking-retained'; localRef: string; reason: string };

export interface RemoteCleanupJournal {
  checkpoint(checkpoint: RemoteCleanupCheckpoint): void | Promise<void>;
}

export interface RemoteCleanupExecuteRequest {
  token: string;
  selectedEndpointIds: string[];
  completedEndpointIds?: string[];
  completedTrackingRefs?: string[];
  permanentlyRetainedTrackingRefs?: string[];
  ownClaimId?: string;
}

export interface RemoteEndpointResult {
  id: string;
  fingerprint: string;
  remote: string;
  branch: string;
  status: 'deleted' | 'already-completed' | 'stale' | 'unknown' | 'skipped';
  message?: string;
}

export interface RemoteCleanupResult {
  ok: boolean;
  endpoints: RemoteEndpointResult[];
  trackingRefsDeleted: string[];
  trackingRefsRetained: { localRef: string; reason: string }[];
}
