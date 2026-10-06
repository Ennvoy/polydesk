import type { GitStatus } from '../../../shared/types';

export interface MetadataRead {
  wsId: string;
  revision: number;
  head: string | null | undefined;
  branch: string | null | undefined;
  expiresAt: number;
}

/** 初次 status 尚未回來時，沿用先讀到的 metadata；之後以 ref/世代/短期限失效。 */
export function reuseMetadataRead(
  previous: MetadataRead | undefined,
  wsId: string,
  revision: number,
  status: Pick<GitStatus, 'head' | 'branch'> | null,
  now: number,
): boolean {
  if (!previous || previous.wsId !== wsId || previous.revision !== revision || previous.expiresAt <= now) return false;
  if (status && previous.head === undefined) {
    previous.head = status.head;
    previous.branch = status.branch;
  }
  return !status || (previous.head === status.head && previous.branch === status.branch);
}
