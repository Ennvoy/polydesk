// F-7 紅軍 A5：序列化佇列 fail-safe（rejection 不毒化鏈 / 不冒泡 unhandledRejection / 不洩漏 / 真序列）。

import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, activeWorkspaceCount, _resetSerialQueue } from './gitSerialQueue';

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
});
