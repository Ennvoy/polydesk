import type { ShellKind } from './types';

export const CLAUDE_BYPASS_COMMAND = 'claude --dangerously-skip-permissions';
export const REMOTE_PORT = 49387;
export const REMOTE_HTTPS_PORT = 8443;
export type PairLifetime = 7 | 30 | 'permanent';
export interface RemoteLaunchEvent { opId: string; termId: string; wsId: string; shell: ShellKind }
export interface RemotePairRequest { id: string; label: string; verification: string; expiresAt: number }
export interface RemoteDevice { id: string; label: string; createdAt: number; expiresAt: number | null }
export interface RemoteStatus {
  enabled: boolean;
  url: string | null;
  error: string | null;
  workspaces: { id: string; name: string; allowed: boolean }[];
  pending: RemotePairRequest[];
  devices: RemoteDevice[];
  audit: { at: number; action: string; deviceId?: string; wsId?: string; result: string }[];
}
export type RemoteResult = { ok: true } | { error: string };
export interface RemotePairChallenge { code: string; url: string; qr: string; expiresAt: number }
