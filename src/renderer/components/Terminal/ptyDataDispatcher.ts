// renderer 的 PTY 高頻資料分流。preload 的 pty:data 是單一廣播通道；若每個 TerminalView 都直接
// ipcRenderer.on，同一 chunk 會先呼叫 N 個 listener 再各自比 termId，N 個活躍終端機形成 O(N²)
// callback 成本。此 dispatcher 全 app 只訂閱來源一次，再以 Map O(1) 找到目標 terminal。

export interface PtyDataPayload {
  termId: string;
  chunk: Uint8Array;
}
type Listener = (chunk: Uint8Array) => void;
type SourceSubscribe = (listener: (payload: PtyDataPayload) => void) => () => void;

export class PtyDataDispatcher {
  private readonly listeners = new Map<string, Set<Listener>>();
  private sourceOff: (() => void) | null = null;

  constructor(private readonly subscribeSource: SourceSubscribe) {}

  subscribe(termId: string, listener: Listener): () => void {
    let listeners = this.listeners.get(termId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(termId, listeners);
    }
    listeners.add(listener);
    this.sourceOff ??= this.subscribeSource(({ termId: target, chunk }) => {
      const targets = this.listeners.get(target);
      if (!targets) return;
      for (const targetListener of targets) targetListener(chunk);
    });

    return () => {
      const current = this.listeners.get(termId);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(termId);
      if (this.listeners.size === 0 && this.sourceOff) {
        this.sourceOff();
        this.sourceOff = null;
      }
    };
  }
}
