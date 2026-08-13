import type {
  GitCleanupRemoteEndpoint,
  GitCleanupRemoteExecution,
  GitCleanupRemotePlan,
  GitCleanupRemoteTrackingLease,
  GitCleanupRemoteTrackingProducer,
} from '../../../../shared/gitCleanup';

export type RemoteEndpointStatus = GitCleanupRemoteEndpoint['status'];
export type RemoteEndpointLease = GitCleanupRemoteEndpoint;
export type RemoteTrackingProducer = GitCleanupRemoteTrackingProducer;

export interface RemoteTrackingSymrefLease {
  ref: string;
  target: string;
  typical: boolean;
}

export type RemoteTrackingLease = GitCleanupRemoteTrackingLease;
export type RemoteCleanupPlan = GitCleanupRemotePlan;

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

export type RemoteCleanupResult = GitCleanupRemoteExecution;
