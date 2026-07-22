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
  it('同工作區並行呼叫共用同一個請求，完成後可重新載入', async () => {
    let resolve!: (value: GitSnapshot) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<GitSnapshot>((res) => { resolve = res; }))
      .mockResolvedValue(SNAPSHOT);
    const load = createGitSnapshotLoader(fetcher);

    const first = load('ws1');
    const second = load('ws1');
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve(SNAPSHOT);
    await expect(first).resolves.toEqual(SNAPSHOT);
    await load('ws1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('不同工作區不互相阻塞', async () => {
    const fetcher = vi.fn(async () => SNAPSHOT);
    const load = createGitSnapshotLoader(fetcher);
    await Promise.all([load('ws1'), load('ws2')]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
