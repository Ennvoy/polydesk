import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCleanupProgressPolling } from './cleanupProgressPolling';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

describe('清理進度輪詢', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('慢查詢最多保留一筆未完成請求，最後一次狀態讀取不會排在大量舊請求後方', async () => {
    const pending = deferred<string>();
    const request = vi.fn(() => pending.promise);
    const onStatus = vi.fn();
    const stop = startCleanupProgressPolling({ request, onStatus, isCurrent: () => true });
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(request).toHaveBeenCalledTimes(1);
      stop();
      const finalStatus = request();
      expect(request).toHaveBeenCalledTimes(2); // 一筆舊進度查詢，加上呼叫端最後一次狀態讀取。
      pending.resolve('closed');
      await expect(finalStatus).resolves.toBe('closed');
      expect(onStatus).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(request).toHaveBeenCalledTimes(2);
    } finally { stop(); }
  });

  it('成功回覆更新進度後，再等完整間隔才查詢下一次', async () => {
    const pending = deferred<string>();
    const request = vi.fn(() => pending.promise);
    const onStatus = vi.fn();
    const stop = startCleanupProgressPolling({ request, onStatus, isCurrent: () => true });
    try {
      await vi.advanceTimersByTimeAsync(250);
      pending.resolve('tracking-deleted');
      await vi.advanceTimersByTimeAsync(0);
      expect(onStatus).toHaveBeenCalledWith('tracking-deleted');
      await vi.advanceTimersByTimeAsync(249);
      expect(request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(request).toHaveBeenCalledTimes(2);
    } finally { stop(); }
  });

  it('查詢失敗會釋放未完成狀態，下一輪仍能成功更新進度', async () => {
    const request = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('暫時讀取失敗'))
      .mockResolvedValue('endpoint-deleted');
    const onStatus = vi.fn();
    const stop = startCleanupProgressPolling({ request, onStatus, isCurrent: () => true });
    try {
      await vi.advanceTimersByTimeAsync(250);
      expect(request).toHaveBeenCalledTimes(1);
      expect(onStatus).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(request).toHaveBeenCalledTimes(2);
      expect(onStatus).toHaveBeenCalledWith('endpoint-deleted');
    } finally { stop(); }
  });

  it('操作結束或取消後忽略遲到回覆，不再發出新查詢', async () => {
    const pending = deferred<string>();
    const request = vi.fn(() => pending.promise);
    const onStatus = vi.fn();
    const stop = startCleanupProgressPolling({ request, onStatus, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(250);
    stop(); stop();
    pending.resolve('old-running');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStatus).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('工作區切換或面板卸載會在發送前停止輪詢', async () => {
    let current = true;
    const request = vi.fn(async () => 'running');
    const onStatus = vi.fn();
    const stop = startCleanupProgressPolling({ request, onStatus, isCurrent: () => current });
    try {
      current = false;
      await vi.advanceTimersByTimeAsync(1000);
      expect(request).not.toHaveBeenCalled();
      expect(onStatus).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it('舊操作的遲到回覆不能覆寫新一輪進度', async () => {
    let generation = 1;
    const pending = deferred<string>();
    const request = vi.fn(() => pending.promise);
    const onStatus = vi.fn();
    const stop = startCleanupProgressPolling({ request, onStatus, isCurrent: () => generation === 1 });
    try {
      await vi.advanceTimersByTimeAsync(250);
      generation = 2;
      pending.resolve('old-running');
      await vi.advanceTimersByTimeAsync(1000);
      expect(onStatus).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it('操作失敗仍由 finally 停止進度，即使舊查詢稍後也失敗', async () => {
    const pending = deferred<string>();
    const request = vi.fn(() => pending.promise);
    const onStatus = vi.fn();
    const stop = startCleanupProgressPolling({ request, onStatus, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(250);
    const operation = async (): Promise<void> => {
      try { throw new Error('清理失敗'); } finally { stop(); }
    };
    await expect(operation()).rejects.toThrow('清理失敗');
    pending.reject(new Error('遲到查詢失敗'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onStatus).not.toHaveBeenCalled();
  });
});
