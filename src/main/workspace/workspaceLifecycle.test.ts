import { describe, expect, it, vi } from 'vitest';
import { WorkspaceLifecycle } from './workspaceLifecycle';

describe('WorkspaceLifecycle teardownStrict', () => {
  it('所有 concern 都執行，任一失敗會回報且不被吞掉', async () => {
    const lifecycle = new WorkspaceLifecycle();
    const first = vi.fn();
    const last = vi.fn();
    lifecycle.register('first', first);
    lifecycle.register('broken', () => {
      throw new Error('still open');
    });
    lifecycle.register('last', last);

    await expect(lifecycle.teardownStrict('ws')).rejects.toThrow('無法安全關閉');
    expect(first).toHaveBeenCalledWith('ws');
    expect(last).toHaveBeenCalledWith('ws');
  });
});
