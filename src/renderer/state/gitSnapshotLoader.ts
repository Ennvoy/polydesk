import type { GitSnapshot } from '../../shared/types';

type SnapshotFetcher = (wsId: string) => Promise<GitSnapshot>;

export interface GitSnapshotLoader extends SnapshotFetcher {
  /** 檔案或 Git 操作已讓快照失效；下一次讀取必須重新掃描。 */
  invalidate: (wsId: string) => void;
  /** 明確失效後讀取，供使用者操作完成／手動重新整理使用。 */
  refresh: (wsId: string) => Promise<GitSnapshot>;
}

/**
 * 同工作區並行讀取共用同一個 promise，完成後保留極短快取。
 * 這個時間窗只用來合併狀態列、活動列與 SCM 面板對同一事件的錯峰讀取；
 * 檔案事件與使用者 Git 操作會明確 invalidate，不把過期狀態當長期 cache。
 */
export function createGitSnapshotLoader(
  fetcher: SnapshotFetcher,
  cacheMs = 600,
  now: () => number = Date.now,
): GitSnapshotLoader {
  const pending = new Map<string, { generation: number; promise: Promise<GitSnapshot> }>();
  const cached = new Map<string, { expiresAt: number; snapshot: GitSnapshot }>();
  const generations = new Map<string, number>();
  const invalidatedAt = new Map<string, number>();

  const load = ((wsId: string): Promise<GitSnapshot> => {
    const generation = generations.get(wsId) ?? 0;
    const current = pending.get(wsId);
    if (current) {
      if (current.generation === generation) return current.promise;
      // 失效發生在舊掃描途中：等它離開 main 的 per-workspace queue，再取一份新快照。
      return current.promise.catch(() => undefined).then(() => load(wsId));
    }
    const hit = cached.get(wsId);
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.snapshot);

    let request: Promise<GitSnapshot>;
    request = fetcher(wsId)
      .then((snapshot) => {
        if ((generations.get(wsId) ?? 0) === generation) {
          cached.set(wsId, { expiresAt: now() + cacheMs, snapshot });
        }
        return snapshot;
      })
      .finally(() => {
        if (pending.get(wsId)?.promise === request) pending.delete(wsId);
      });
    pending.set(wsId, { generation, promise: request });
    return request;
  }) as GitSnapshotLoader;

  const invalidate = (wsId: string, force: boolean): void => {
    const timestamp = now();
    // 同一批 fs:change 會同步送到多個 UI 訂閱者；只遞增一次世代，避免把剛啟動的共用掃描誤標過期。
    if (!force && timestamp - (invalidatedAt.get(wsId) ?? Number.NEGATIVE_INFINITY) < 25) return;
    invalidatedAt.set(wsId, timestamp);
    cached.delete(wsId);
    generations.set(wsId, (generations.get(wsId) ?? 0) + 1);
  };
  load.invalidate = (wsId: string): void => invalidate(wsId, false);
  load.refresh = (wsId: string): Promise<GitSnapshot> => {
    invalidate(wsId, true);
    return load(wsId);
  };
  return load;
}
