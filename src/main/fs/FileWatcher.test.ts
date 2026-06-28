// FileWatcher / fs:tree 紅軍 fail-safe 單元測試（真 temp 目錄 + 真 chokidar + 真 junction）。
// 對應攻擊：F-2-A1 路徑穿越、A2 symlink 逃逸、A3 ignored 失效、A4 lazy-start 競態/殭屍、A5 事件洪水。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, symlinkSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar, { type FSWatcher } from 'chokidar';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { EventChannels } from '../../shared/ipc';
import {
  FileWatcher,
  listTree,
  registerFsTreeAndWatch,
  type TreeEntry,
  type WatchFactory,
} from './FileWatcher';

type FsChange = EventChannels['fs:change'];

const WS = 'ws_test';
const tmpDirs: string[] = [];
const liveWatchers: FileWatcher[] = [];

function mkTmp(prefix = 'pd-fw-'): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function track(fw: FileWatcher): FileWatcher {
  liveWatchers.push(fw);
  return fw;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 假 watcher：A1 不需要真實檔案系統監看時注入，省去真 chokidar 開銷。 */
function fakeWatcher(): FSWatcher {
  const ee = new EventEmitter();
  (ee as unknown as { close: () => Promise<void> }).close = async () => {};
  return ee as unknown as FSWatcher;
}

/** 最小 IpcMain 替身：捕捉 handle、可 invoke。 */
function makeFakeIpc(): {
  handle(ch: string, fn: (e: unknown, req: unknown) => unknown): void;
  invoke(ch: string, req: unknown): Promise<unknown>;
} {
  const handlers = new Map<string, (e: unknown, req: unknown) => unknown>();
  return {
    handle(ch, fn) {
      handlers.set(ch, fn);
    },
    invoke(ch, req) {
      const h = handlers.get(ch);
      if (!h) throw new Error(`no handler: ${ch}`);
      return Promise.resolve(h({}, req));
    },
  };
}

function fakeWsManager(map: Record<string, string>): WorkspaceManager {
  return {
    get: (id: string) => (map[id] ? { path: map[id] } : undefined),
  } as unknown as WorkspaceManager;
}

type RegisterIpc = Parameters<typeof registerFsTreeAndWatch>[0];

afterEach(async () => {
  await Promise.all(liveWatchers.splice(0).map((fw) => fw.closeAll().catch(() => {})));
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe('F-2-A1 路徑穿越：fs:tree 的 dir 約束在 workspace 內', () => {
  it('攻擊矩陣全部回 {entries:[]}，且 fs.promises.readdir 從未被以界外路徑呼叫', async () => {
    const ws = mkTmp();
    writeFileSync(path.join(ws, 'inside.txt'), 'ok');

    const readdirSpy = vi.spyOn(fsp, 'readdir');

    const ipc = makeFakeIpc();
    const fw = track(
      registerFsTreeAndWatch(ipc as unknown as RegisterIpc, fakeWsManager({ [WS]: ws }), new WorkspaceLifecycle(), {
        watchFactory: () => fakeWatcher(),
      }),
    );
    void fw;

    const attacks = [
      '../../etc',
      '..\\..\\Windows',
      'C:\\Windows\\System32',
      '\\\\attacker\\share', // UNC
      '//attacker/share', // forward-slash UNC
      '\\\\?\\C:\\', // extended-length
      '\\\\.\\PhysicalDrive0', // device namespace
      'CON', // 保留名
    ];

    for (const dir of attacks) {
      const res = (await ipc.invoke('fs:tree', { wsId: WS, dir })) as { entries: TreeEntry[] };
      expect(res.entries).toEqual([]);
    }

    // 界外路徑連 readdir 都不該碰
    expect(readdirSpy).not.toHaveBeenCalled();

    // sanity：合法 dir 確實會 readdir 並回內容（證明 spy 不是假陰性）
    const ok = (await ipc.invoke('fs:tree', { wsId: WS, dir: '.' })) as { entries: TreeEntry[] };
    expect(ok.entries.some((e) => e.name === 'inside.txt')).toBe(true);
    expect(readdirSpy).toHaveBeenCalledTimes(1);
    // readdir 收到的解析路徑一律落在 workspace（realpath）內（listTree 傳入已 realpath 的路徑）
    const realWs = (await fsp.realpath(ws)).toLowerCase();
    for (const call of readdirSpy.mock.calls) {
      expect(String(call[0]).toLowerCase().startsWith(realWs)).toBe(true);
    }
  });
});

describe('F-2-A2 symlink 逃逸：realpath containment + followSymlinks:false', () => {
  it('fs:tree 對指向工作區外的 junction 回空、不列出外部內容', async () => {
    const ws = mkTmp();
    const ext = mkTmp('pd-ext-');
    writeFileSync(path.join(ext, 'secret.txt'), 'top-secret');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(ext, path.join(ws, 'escape'), linkType);

    const res = await listTree(ws, 'escape');
    expect(res.entries).toEqual([]);
    expect(res.entries.find((e) => e.name === 'secret.txt')).toBeUndefined();
  });

  it('watcher 不跟 symlink 出界：在 junction 目標內新增檔不觸發 fs:change', async () => {
    const ws = mkTmp();
    const ext = mkTmp('pd-ext-');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(ext, path.join(ws, 'escape'), linkType);

    const events: FsChange[] = [];
    const fw = track(
      new FileWatcher(() => ws, { emit: (p) => events.push(p), coalesceMs: 30, awaitWriteFinishMs: 20 }),
    );
    fw.ensureWatch(WS);
    await fw.whenReady(WS);

    writeFileSync(path.join(ext, 'new-after.txt'), 'x'); // 在工作區外（junction 目標）新增
    await delay(300);

    // 安全性：followSymlinks:false → 不跟 junction 出界，收不到目標內新增檔的事件
    expect(events.some((e) => e.path.includes('new-after'))).toBe(false);
  });
});

describe('F-2-A3 ignored 路徑分段比對（chokidar v5 無 glob）', () => {
  it('node_modules / .git 內變動不觸發；src 內變動會觸發', async () => {
    const ws = mkTmp();
    mkdirSync(path.join(ws, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(path.join(ws, 'node_modules', 'pkg', 'index.js'), 'x');
    mkdirSync(path.join(ws, '.git', 'objects', 'aa'), { recursive: true });
    writeFileSync(path.join(ws, '.git', 'objects', 'aa', 'bb'), 'x');
    mkdirSync(path.join(ws, 'src'), { recursive: true });

    const events: FsChange[] = [];
    const fw = track(
      new FileWatcher(() => ws, { emit: (p) => events.push(p), coalesceMs: 30, awaitWriteFinishMs: 20 }),
    );
    fw.ensureWatch(WS);
    await fw.whenReady(WS);

    writeFileSync(path.join(ws, 'node_modules', 'pkg', 'added.js'), 'x');
    writeFileSync(path.join(ws, '.git', 'objects', 'aa', 'cc'), 'x');
    writeFileSync(path.join(ws, 'src', 'a.ts'), 'x');
    await delay(350);

    // node_modules / .git 內變動完全不觸發（watcher 層即排除）
    expect(events.some((e) => e.path.includes('node_modules'))).toBe(false);
    expect(events.some((e) => e.path.startsWith('.git'))).toBe(false);
    // src 內新增 → 逐檔推送該檔（path＝工作區相對 POSIX、kind=add）
    expect(events.some((e) => e.path === 'src/a.ts')).toBe(true);
  });
});

describe('F-2-A4 lazy-start 冪等 + teardown 無殭屍', () => {
  it('同 wsId 並發 fs:tree ×5 只建一個 watcher；teardown 後新增檔收不到事件', async () => {
    const ws = mkTmp();
    let created = 0;
    const factory: WatchFactory = (r, o) => {
      created++;
      return chokidar.watch(r, o);
    };

    const events: FsChange[] = [];
    const lifecycle = new WorkspaceLifecycle();
    const ipc = makeFakeIpc();
    const fw = track(
      registerFsTreeAndWatch(ipc as unknown as RegisterIpc, fakeWsManager({ [WS]: ws }), lifecycle, {
        watchFactory: factory,
        emit: (p) => events.push(p),
        coalesceMs: 30,
        awaitWriteFinishMs: 20,
      }),
    );

    // 不 await 連發 5 次（模擬 StrictMode 雙呼 / 雙面板 / 快速雙擊）
    await Promise.all(Array.from({ length: 5 }, () => ipc.invoke('fs:tree', { wsId: WS, dir: '.' })));
    expect(created).toBe(1);
    expect(fw.size).toBe(1);
    await fw.whenReady(WS);

    // teardown 經 lifecycle('watcher') 完整收尾
    await lifecycle.teardown(WS);
    expect(fw.size).toBe(0);

    events.length = 0;
    writeFileSync(path.join(ws, 'zombie-check.txt'), 'x');
    await delay(300);
    expect(events.length).toBe(0);
  });
});

describe('F-2-A5 事件洪水 coalesce + awaitWriteFinish', () => {
  it('短時間新增 500 檔，flood breaker 把推送數壓到遠小於 500（且 < 上限+對帳）', async () => {
    const ws = mkTmp();
    const events: FsChange[] = [];
    const fw = track(
      new FileWatcher(() => ws, {
        emit: (p) => events.push(p),
        coalesceMs: 50,
        awaitWriteFinishMs: 20,
        maxBatch: 30, // 一波逐檔上限；超量切 coarse
      }),
    );
    fw.ensureWatch(WS);
    await fw.whenReady(WS);

    for (let i = 0; i < 500; i++) writeFileSync(path.join(ws, `f${i}.txt`), 'x');
    await delay(1000); // 含波結束靜止後的根目錄對帳

    // 逐檔至多 ~maxBatch 筆 → 切 coarse 推根目錄重抓 → 靜止後再對帳一次：總數遠小於 500
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(50);
    // 洪水期間至少出現一次 coarse「根目錄重抓」訊號（path===''）
    expect(events.some((e) => e.path === '')).toBe(true);
  }, 15000);

  it('單一檔多段寫入只收到一次穩定事件（awaitWriteFinish）', async () => {
    const ws = mkTmp();
    const events: FsChange[] = [];
    const fw = track(
      new FileWatcher(() => ws, { emit: (p) => events.push(p), coalesceMs: 50, awaitWriteFinishMs: 30 }),
    );
    fw.ensureWatch(WS);
    await fw.whenReady(WS);

    const f = path.join(ws, 'big.txt');
    writeFileSync(f, 'a');
    await delay(3);
    appendFileSync(f, 'bb');
    await delay(3);
    appendFileSync(f, 'ccc');
    await delay(400);

    // awaitWriteFinish 把多段寫入收斂成單一穩定 add → 逐檔只推一次該檔
    expect(events.length).toBe(1);
    expect(events[0].path.includes('big.txt')).toBe(true);
  }, 10000);
});
