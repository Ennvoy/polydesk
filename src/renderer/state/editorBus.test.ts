// editorBus 派送隔離迴歸：訂閱者依序同步執行，任一訂閱者 throw 不得炸斷派送鏈
// （病根：DockLayout 叫回編輯器排在 EditorGroup 開檔之前，例外外洩＝點檔無反應）。
import { describe, expect, it } from 'vitest';
import { editorBus } from './editorBus';

describe('editorBus 派送隔離', () => {
  it('openFile：前面的訂閱者 throw，後面的訂閱者仍收到請求', () => {
    const seen: string[] = [];
    const off1 = editorBus.subscribe(() => {
      seen.push('boom');
      throw new Error('Invalid from location'); // 模擬 dockview 版面暫態 throw
    });
    const off2 = editorBus.subscribe((req) => seen.push(`open:${req.path}`));

    expect(() => editorBus.openFile({ wsId: 'w1', path: 'a.md' })).not.toThrow();
    expect(seen).toEqual(['boom', 'open:a.md']);
    off1();
    off2();
  });

  it('openDiff：同樣隔離；退訂後不再收到', () => {
    const seen: string[] = [];
    const off1 = editorBus.subscribeDiff(() => {
      throw new Error('boom');
    });
    const off2 = editorBus.subscribeDiff((req) => seen.push(`diff:${req.path}:${req.staged}`));

    expect(() => editorBus.openDiff({ wsId: 'w1', path: 'b.ts', staged: true })).not.toThrow();
    expect(seen).toEqual(['diff:b.ts:true']);

    off2();
    editorBus.openDiff({ wsId: 'w1', path: 'c.ts', staged: false });
    expect(seen).toEqual(['diff:b.ts:true']); // off2 退訂後不再累積
    off1();
  });

  it('EditorGroup 不存在時暫存最新開檔請求，重新掛載後補送一次', async () => {
    editorBus.openFile({ wsId: 'w1', path: 'first.md' });
    editorBus.openFile({ wsId: 'w1', path: 'latest.md' });
    const seen: string[] = [];
    const off = editorBus.subscribeEditor((req) => seen.push(req.path));

    await Promise.resolve(); // 等待 StrictMode-safe microtask replay
    expect(seen).toEqual(['latest.md']);
    off();
  });

  it('EditorGroup 已掛載時同步收到請求，不殘留到下次掛載', async () => {
    const seen: string[] = [];
    const off = editorBus.subscribeEditor((req) => seen.push(req.path));
    editorBus.openFile({ wsId: 'w1', path: 'now.md' });
    expect(seen).toEqual(['now.md']);
    off();

    const replayed: string[] = [];
    const off2 = editorBus.subscribeEditor((req) => replayed.push(req.path));
    await Promise.resolve();
    expect(replayed).toEqual([]);
    off2();
  });
});
