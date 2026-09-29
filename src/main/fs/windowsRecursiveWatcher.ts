// Windows 原生遞迴監看：一個工作區只開一個 fs.watch handle，避免 chokidar 對每個檔案
// 各開一個 handle（大型 .next / downloads 目錄會讓 Electron main 累積數萬個 handle）。
import { EventEmitter } from 'node:events';
import { watch, promises as fsp, type FSWatcher } from 'node:fs';
import * as path from 'node:path';

type ChangeKind = 'add' | 'change' | 'unlink';

function contained(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** 只暴露 FileWatcher 需要的事件與 close/ready 契約。 */
export class WindowsRecursiveWatcher extends EventEmitter {
  private readonly native: FSWatcher;
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout>; renamed: boolean }>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private coarse = false;
  private closed = false;
  private realRoot = '';

  constructor(
    private readonly root: string,
    private readonly ignored: (fullPath: string) => boolean,
    private readonly maxBatch: number,
    private readonly stabilityMs: number,
  ) {
    super();
    this.native = watch(root, { recursive: true }, (event, filename) => {
      if (this.closed) return;
      if (!filename) {
        this.emit('change', root);
        return;
      }
      const full = path.resolve(root, String(filename));
      if (!contained(root, full) || this.ignored(full)) return;
      this.schedule(full, event === 'rename');
    });
    this.native.on('error', (error) => this.emit('error', error));
    void fsp.realpath(root).then((real) => {
      if (this.closed) return;
      this.realRoot = real;
      this.emit('ready');
    }).catch((error) => this.emit('error', error));
  }

  private schedule(full: string, renamed: boolean): void {
    if (this.coarse) {
      this.armIdle();
      return;
    }
    const previous = this.pending.get(full);
    if (previous) clearTimeout(previous.timer);
    if (!previous && this.pending.size >= this.maxBatch) {
      for (const entry of this.pending.values()) clearTimeout(entry.timer);
      this.pending.clear();
      this.coarse = true;
      this.emit('change', this.root);
      this.armIdle();
      return;
    }
    const timer = setTimeout(() => {
      this.pending.delete(full);
      void this.classify(full, renamed || previous?.renamed === true);
    }, this.stabilityMs);
    this.pending.set(full, { timer, renamed: renamed || previous?.renamed === true });
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.coarse = false;
      if (!this.closed) this.emit('change', this.root);
    }, Math.max(250, this.stabilityMs * 3));
  }

  private async classify(full: string, renamed: boolean): Promise<void> {
    if (this.closed || !this.realRoot) return;
    // Windows 遞迴事件可能包含 junction 下的路徑；只接受實際父目錄仍在工作區內的事件。
    let parent = path.dirname(full);
    let realParent: string | null = null;
    while (contained(this.root, parent)) {
      try {
        realParent = await fsp.realpath(parent);
        break;
      } catch {
        if (parent === this.root) break;
        parent = path.dirname(parent);
      }
    }
    if (!realParent || !contained(this.realRoot, realParent)) return;
    let kind: ChangeKind;
    try {
      await fsp.lstat(full);
      kind = renamed ? 'add' : 'change';
    } catch {
      kind = 'unlink';
    }
    if (!this.closed) this.emit(kind, full);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.native.close();
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.removeAllListeners();
  }
}
