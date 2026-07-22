import type { GitSnapshot } from '../../shared/types';

type SnapshotFetcher = (wsId: string) => Promise<GitSnapshot>;

/** 同工作區並行讀取共用同一個 promise；完成或失敗後即釋放，不快取可能過期的 Git 狀態。 */
export function createGitSnapshotLoader(fetcher: SnapshotFetcher): SnapshotFetcher {
  const pending = new Map<string, Promise<GitSnapshot>>();
  return (wsId: string): Promise<GitSnapshot> => {
    const current = pending.get(wsId);
    if (current) return current;
    const request = fetcher(wsId).finally(() => {
      if (pending.get(wsId) === request) pending.delete(wsId);
    });
    pending.set(wsId, request);
    return request;
  };
}
