import { describe, expect, it, vi } from 'vitest';
import type { GitWorktree } from '../../shared/types';
import { createWorktreeBranchLoader } from './worktreeBranchLoader';

const entry = (path: string, branch: string | null, managedWsId?: string): GitWorktree => ({
  path, branch, managedWsId, head: 'abc', isMain: false, prunable: false,
});
const request = { wsId: 'linked', path: 'C:/repo/linked', mainPath: 'C:/repo/main' };

describe('worktree 分支徽章 metadata loader', () => {
  it('同 repository 的 100 個徽章只發一次 worktreeList，不逐工作區掃描 status', async () => {
    let resolve!: (value: { list: GitWorktree[] }) => void;
    const fetcher = vi.fn(() => new Promise<{ list: GitWorktree[] }>((done) => { resolve = done; }));
    const loader = createWorktreeBranchLoader(fetcher, 600, Date.now, true);
    const calls = Array.from({ length: 100 }, (_, index) => loader.load({
      wsId: `ws-${index}`,
      path: `C:/repo/linked-${index}`,
      mainPath: index % 2 === 0 ? 'C:/repo/main' : 'c:\\repo\\MAIN\\',
    }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve({ list: Array.from({ length: 100 }, (_, index) => entry(`C:/repo/linked-${index}`, `branch-${index}`, `ws-${index}`)) });
    await expect(Promise.all(calls)).resolves.toEqual(Array.from({ length: 100 }, (_, index) => `branch-${index}`));
  });

  it('優先使用 managedWsId，路徑備援統一 Windows 斜線與大小寫', async () => {
    const fetcher = vi.fn(async () => ({ list: [
      entry(request.path, 'path-match'),
      entry('C:/other/path', 'id-match', request.wsId),
      entry('C:/repo/fallback', null),
      { ...entry('C:/repo/stale', 'stale'), prunable: true },
    ] }));
    const loader = createWorktreeBranchLoader(fetcher, 600, Date.now, true);
    await expect(loader.load(request)).resolves.toBe('id-match');
    await expect(loader.load({ ...request, wsId: 'fallback', path: 'c:\\REPO\\fallback\\' })).resolves.toBeNull();
    await expect(loader.load({ ...request, wsId: 'stale', path: 'C:/repo/stale' })).resolves.toBeUndefined();
    await expect(loader.load({ ...request, wsId: 'unknown', path: 'C:/repo/unknown' })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('非 Windows 路徑不合併大小寫不同的 repository，也不錯配工作樹', async () => {
    const fetcher = vi.fn(async () => ({ list: [entry('/repo/Linked', 'feature')] }));
    const loader = createWorktreeBranchLoader(fetcher, 600, Date.now, false);
    await expect(loader.load({ wsId: 'a', mainPath: '/repo/Main', path: '/repo/linked' })).resolves.toBeUndefined();
    await expect(loader.load({ wsId: 'b', mainPath: '/repo/main', path: '/repo/Linked' })).resolves.toBe('feature');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('短快取逾時後重讀，linked 路徑失效會通知同組徽章', async () => {
    let now = 1000;
    const fetcher = vi.fn(async () => ({ list: [entry(request.path, 'feature')] }));
    const loader = createWorktreeBranchLoader(fetcher, 600, () => now, true);
    const notified = vi.fn();
    const unsubscribe = loader.subscribe(request.mainPath, notified);
    await loader.load(request);
    await loader.load(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 601;
    await loader.load(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
    loader.invalidate('c:\\repo\\LINKED');
    expect(notified).toHaveBeenCalledTimes(1);
    await loader.load(request);
    expect(fetcher).toHaveBeenCalledTimes(3);
    unsubscribe();
    loader.invalidate();
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('建立或納管後先失效舊清單，新徽章即使在快取期限內也讀到新 worktree', async () => {
    let list: GitWorktree[] = [entry('C:/repo/main', 'main', 'main')];
    const fetcher = vi.fn(async () => ({ list: [...list] }));
    const loader = createWorktreeBranchLoader(fetcher, 600, () => 1000, true);
    await expect(loader.load(request)).resolves.toBeUndefined();
    list = [...list, entry(request.path, 'feature', request.wsId)];
    await expect(loader.load(request)).resolves.toBeUndefined();
    loader.invalidate(request.mainPath);
    await expect(loader.load(request)).resolves.toBe('feature');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('失效途中不重用舊世代回包，錯誤不留快取且下一次可重試', async () => {
    let resolve!: (value: { list: GitWorktree[] }) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<{ list: GitWorktree[] }>((done) => { resolve = done; }))
      .mockResolvedValueOnce({ list: [entry(request.path, 'fresh')] })
      .mockResolvedValueOnce({ error: 'unavailable' })
      .mockResolvedValue({ list: [entry(request.path, 'recovered')] });
    const loader = createWorktreeBranchLoader(fetcher);
    const stale = loader.load(request);
    loader.invalidate(request.mainPath);
    const fresh = loader.load(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve({ list: [entry(request.path, 'stale')] });
    await expect(stale).resolves.toBe('stale');
    await expect(fresh).resolves.toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(2);
    loader.invalidate();
    await expect(loader.load(request)).rejects.toThrow('unavailable');
    await expect(loader.load(request)).resolves.toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
