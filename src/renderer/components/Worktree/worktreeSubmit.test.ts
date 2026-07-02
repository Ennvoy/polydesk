// F-11 送出動作單測（紅軍 A2/A3）：防重入 + 送出前重抓複查。
import { describe, it, expect, vi } from 'vitest';
import { makeCreateAction, friendlyCreateError } from './worktreeSubmit';

describe('friendlyCreateError 映射（紅軍 A5：net→retry）', () => {
  it('net → 可重試；branch-taken/path-exists/invalid-path → 不重試', () => {
    expect(friendlyCreateError('net', 'x').retry).toBe(true);
    expect(friendlyCreateError('branch-taken', 'x').retry).toBe(false);
    expect(friendlyCreateError('path-exists', 'x').retry).toBe(false);
    expect(friendlyCreateError('invalid-path', 'bad').msg).toContain('bad');
    expect(friendlyCreateError(undefined, 'raw msg')).toEqual({ msg: 'raw msg', retry: true });
  });
});

const branch = { kind: 'existing' as const, name: 'feat/x' };

describe('makeCreateAction 防重入（紅軍 A3）', () => {
  it('前次未 settle 前的重複呼叫 → worktreeAdd 恰呼叫 1 次', async () => {
    let resolveAdd: (v: { wsId: string }) => void = () => {};
    const worktreeAdd = vi.fn(() => new Promise<{ wsId: string }>((r) => (resolveAdd = r)));
    const worktreeList = vi.fn(async () => ({ list: [] }));
    const create = makeCreateAction({ worktreeList, worktreeAdd });

    const p1 = create({ wsId: 'ws1', branch, path: '/x' });
    const p2 = create({ wsId: 'ws1', branch, path: '/x' }); // 併發第二次
    const r2 = await p2;
    expect(r2).toEqual({ kind: 'ignored' });
    resolveAdd({ wsId: 'ws2' });
    expect(await p1).toEqual({ kind: 'ok', wsId: 'ws2' });
    expect(worktreeAdd).toHaveBeenCalledTimes(1);
  });

  it('settle 後可再次送出（旗標已釋放）', async () => {
    const worktreeAdd = vi.fn(async () => ({ wsId: 'ws2' }));
    const worktreeList = vi.fn(async () => ({ list: [] }));
    const create = makeCreateAction({ worktreeList, worktreeAdd });
    await create({ wsId: 'ws1', branch, path: '/x' });
    await create({ wsId: 'ws1', branch, path: '/y' });
    expect(worktreeAdd).toHaveBeenCalledTimes(2);
  });
});

describe('makeCreateAction 送出前重抓複查（紅軍 A2 TOCTOU）', () => {
  it('開窗時未佔、送出時已佔 → 用新快照回 conflict，不呼叫 worktreeAdd', async () => {
    // worktreeList 於送出當下回「已被佔用」（模擬期間終端機手動 checkout）
    const worktreeList = vi.fn(async () => ({ list: [{ branch: 'feat/x', path: 'C:/wt/feat-x', head: 'a', isMain: false, prunable: false }] }));
    const worktreeAdd = vi.fn(async () => ({ wsId: 'ws2' }));
    const create = makeCreateAction({ worktreeList, worktreeAdd });
    const r = await create({ wsId: 'ws1', branch, path: '/x' });
    expect(r).toEqual({ kind: 'conflict', branch: 'feat/x', at: 'C:/wt/feat-x' });
    expect(worktreeAdd).not.toHaveBeenCalled();
  });

  it('送出時仍空 → 正常建立', async () => {
    const worktreeList = vi.fn(async () => ({ list: [] }));
    const worktreeAdd = vi.fn(async () => ({ wsId: 'ws2' }));
    const create = makeCreateAction({ worktreeList, worktreeAdd });
    expect(await create({ wsId: 'ws1', branch, path: '/x' })).toEqual({ kind: 'ok', wsId: 'ws2' });
    expect(worktreeAdd).toHaveBeenCalledTimes(1);
  });
});
