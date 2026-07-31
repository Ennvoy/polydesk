import { describe, expect, it, vi } from 'vitest';
import type { GitSnapshot } from '../../shared/types';
import { createGitSnapshotLoader } from './gitSnapshotLoader';

const SNAPSHOT: GitSnapshot = {
  status: {
    isRepo: true,
    head: 'abc',
    branch: 'main',
    ahead: 0,
    behind: 0,
    changedCount: 1,
    detached: false,
    hasRemote: true,
  },
  changes: [{ path: 'a.txt', status: 'M', staged: false }],
};

describe('Git snapshot single-flight', () => {
  it('同工作區並行與短時錯峰呼叫共用快照，逾時後才重新載入', async () => {
    let resolve!: (value: GitSnapshot) => void;
    let now = 1000;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<GitSnapshot>((res) => { resolve = res; }))
      .mockResolvedValue(SNAPSHOT);
    const load = createGitSnapshotLoader(fetcher, 600, () => now);

    const first = load('ws1');
    const second = load('ws1');
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve(SNAPSHOT);
    await expect(first).resolves.toEqual(SNAPSHOT);
    await load('ws1');
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 601;
    await load('ws1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidate 讓錯峰元件取得新快照，舊 in-flight 完成後才啟動新掃描', async () => {
    let resolve!: (value: GitSnapshot) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<GitSnapshot>((res) => { resolve = res; }))
      .mockResolvedValue(SNAPSHOT);
    const load = createGitSnapshotLoader(fetcher);

    const stale = load('ws1');
    load.invalidate('ws1');
    const fresh = load('ws1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(SNAPSHOT);
    await stale;
    await fresh;
    expect(fetcher).toHaveBeenCalledTimes(2);

    await load.refresh('ws1');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('不同工作區不互相阻塞', async () => {
    const fetcher = vi.fn(async () => SNAPSHOT);
    const load = createGitSnapshotLoader(fetcher);
    await Promise.all([load('ws1'), load('ws2')]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
