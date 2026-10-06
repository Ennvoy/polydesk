// F-7 紅軍 A5：序列化佇列 fail-safe（rejection 不毒化鏈 / 不冒泡 unhandledRejection / 不洩漏 / 真序列）。

import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, enqueueRead, enqueueScan, activeWorkspaceCount, _resetSerialQueue } from './gitSerialQueue';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('gitSerialQueue（A5）', () => {
  beforeEach(() => {
    _resetSerialQueue();
  });

  it('單一 task reject 不毒化鏈：後續仍執行且各自 settle 正確', async () => {
    const order: string[] = [];
    const p1 = enqueue('w', async () => {
      order.push('a');
      throw new Error('boom');
    });
    const p2 = enqueue('w', async () => {
      order.push('b');
      return 'ok';
    });
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(order).toEqual(['a', 'b']);
  });

  it('鏈尾 rejection 不冒泡成 process unhandledRejection', async () => {
    let fired = false;
    const onUnhandled = (): void => {
      fired = true;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const p = enqueue('w', async () => {
        throw new Error('x');
      });
      await expect(p).rejects.toThrow('x');
      await tick();
      await tick();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(fired).toBe(false);
  });

  it('全部 settle 後清掉 Map key（鏈不無限延長 / 不洩漏）', async () => {
    await enqueue('w1', async () => 1).catch(() => undefined);
    await enqueue('w2', async () => {
      throw new Error('e');
    }).catch(() => undefined);
    await tick();
    await tick();
    expect(activeWorkspaceCount()).toBe(0);
  });

  it('同 wsId 真序列：執行區間互不重疊（maxActive=1）', async () => {
    let active = 0;
    let maxActive = 0;
    const job = (): Promise<void> =>
      enqueue('w', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
      });
    await Promise.all([job(), job(), job()]);
    expect(maxActive).toBe(1);
  });

  it('不同 wsId 可並行（互不阻塞）', async () => {
    let active = 0;
    let maxActive = 0;
    const job = (ws: string): Promise<void> =>
      enqueue(ws, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
      });
    await Promise.all([job('a'), job('b'), job('c')]);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('同 repository 讀取並行，寫入等待全部讀取，後續讀取不越過寫入', async () => {
    const order: string[] = [];
    let releaseReads!: () => void;
    let releaseWrite!: () => void;
    const readsDone = new Promise<void>((resolve) => { releaseReads = resolve; });
    const writeDone = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const first = enqueueRead('repo', async () => { order.push('read-1'); await readsDone; });
    const second = enqueueRead('repo', async () => { order.push('read-2'); await readsDone; });
    const write = enqueue('repo', async () => { order.push('write'); await writeDone; });
    const last = enqueueRead('repo', async () => { order.push('read-3'); });
    await tick();
    expect(order).toEqual(['read-1', 'read-2']);
    releaseReads();
    await Promise.all([first, second]);
    await tick();
    expect(order).toEqual(['read-1', 'read-2', 'write']);
    releaseWrite();
    await Promise.all([write, last]);
    expect(order).toEqual(['read-1', 'read-2', 'write', 'read-3']);
    await tick();
    expect(activeWorkspaceCount()).toBe(0);
  });

  it('讀取失敗後寫入仍執行並清掉鏈尾', async () => {
    const read = enqueueRead('repo', async () => { throw new Error('read failed'); });
    const write = enqueue('repo', async () => 'written');
    await expect(read).rejects.toThrow('read failed');
    await expect(write).resolves.toBe('written');
    await tick();
    expect(activeWorkspaceCount()).toBe(0);
  });

  it('大量狀態掃描最多兩個並行，metadata 讀取不等掃描 permit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const scans = Array.from({ length: 8 }, () => enqueueScan('repo', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
    }));
    const metadata = enqueueRead('repo', () => 'metadata');
    await expect(metadata).resolves.toBe('metadata');
    expect(maxActive).toBe(2);
    release();
    await Promise.all(scans);
    expect(maxActive).toBe(2);
    await tick();
    expect(activeWorkspaceCount()).toBe(0);
  });

  it('寫入等待所有已排掃描，失敗掃描歸還 permit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    let written = false;
    const scans = Array.from({ length: 4 }, (_, index) => enqueueScan('repo', async () => {
      started += 1;
      await gate;
      if (index === 0) throw new Error('scan failed');
    }));
    const writer = enqueue('repo', () => { written = true; });
    await tick();
    expect(started).toBe(2);
    expect(written).toBe(false);
    release();
    await Promise.allSettled(scans);
    await writer;
    expect(started).toBe(4);
    expect(written).toBe(true);
    const next = await enqueueScan('repo', () => 'reused');
    expect(next).toBe('reused');
  });
});
