import { describe, expect, it, vi } from 'vitest';
import { PtyDataDispatcher, type PtyDataPayload } from './ptyDataDispatcher';

describe('PtyDataDispatcher', () => {
  it('多個 terminal 共用單一來源訂閱，chunk 只送給相符 termId', () => {
    let sourceListener: ((payload: PtyDataPayload) => void) | null = null;
    const sourceOff = vi.fn();
    const subscribeSource = vi.fn((listener: (payload: PtyDataPayload) => void) => {
      sourceListener = listener;
      return sourceOff;
    });
    const dispatcher = new PtyDataDispatcher(subscribeSource);
    const a = vi.fn();
    const b = vi.fn();
    const offA = dispatcher.subscribe('a', a);
    const offB = dispatcher.subscribe('b', b);

    expect(subscribeSource).toHaveBeenCalledTimes(1);
    sourceListener!({ termId: 'b', chunk: new Uint8Array([2]) });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(new Uint8Array([2]));

    offA();
    expect(sourceOff).not.toHaveBeenCalled();
    offB();
    expect(sourceOff).toHaveBeenCalledTimes(1);
  });
});
