// F-5 LspManager 單元測試（紅軍 fail-safe，可注入式 + 真實演算法，不 mock 被測邏輯）。
//  A1 受信任閘門：未信任工作區開檔 → spawn 0 次、降級；信任後才 spawn，且 env 帶 GOTOOLCHAIN=local、
//     command 為解析的絕對路徑（非裸名）。
//  A3 越權轉發：workspace/executeCommand 不轉發、回 error 且不 spawn；工作區外 uri 被拒不 didOpen；
//     不屬該工作區的 wsId 被拒。
//  A5 卡死/teardown：request 逾時回 error（非永久 pending）；工作區 teardown 對 LS tree-kill；spawn
//     error/exit → 清理降級。
//  A4（輔）：diagnostics 推送前截斷數量上限。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import {
  ContentLengthLimiter,
  LspManager,
  parseContentLength,
  type LspChild,
  type LspConnection,
  type LspSpawnFn,
  type LspWorkspaceView,
} from './LspManager';

// ── 受控 fake（真實資料結構、真實演算法路徑；只替換外部相依 spawn/連線）──

class FakeChild implements LspChild {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = null;
  killed = 0;
  private readonly handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  constructor(readonly pid: number | undefined = 4242) {}
  on(event: 'error' | 'exit', listener: (...args: unknown[]) => void): this {
    (this.handlers[event] ??= []).push(listener);
    return this;
  }
  kill(): boolean {
    this.killed++;
    return true;
  }
  emitError(e: Error): void {
    (this.handlers['error'] ?? []).forEach((h) => h(e));
  }
  emitExit(code = 0): void {
    (this.handlers['exit'] ?? []).forEach((h) => h(code));
  }
}

class FakeConn implements LspConnection {
  notifications: { method: string; params: unknown }[] = [];
  requests: { method: string; params: unknown }[] = [];
  listened = 0;
  disposed = 0;
  private readonly notifHandlers = new Map<string, (p: unknown) => void>();
  constructor(private readonly behavior: (method: string, params: unknown) => Promise<unknown>) {}
  listen(): void {
    this.listened++;
  }
  sendRequest(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return this.behavior(method, params);
  }
  sendNotification(method: string, params: unknown): void {
    this.notifications.push({ method, params });
  }
  onNotification(method: string, handler: (p: unknown) => void): void {
    this.notifHandlers.set(method, handler);
  }
  onClose(_handler: () => void): void {
    /* 不自動觸發 */
  }
  onError(_handler: (e: unknown) => void): void {
    /* 不自動觸發 */
  }
  dispose(): void {
    this.disposed++;
  }
  /** 測試驅動：模擬伺服器推 diagnostics。 */
  pushDiagnostics(p: unknown): void {
    this.notifHandlers.get('textDocument/publishDiagnostics')?.(p);
  }
}

class FakeWs implements LspWorkspaceView {
  private readonly map = new Map<string, { path: string; trusted: boolean; hydrated: boolean }>();
  get(wsId: string): { path: string; trusted: boolean; hydrated: boolean } | undefined {
    return this.map.get(wsId);
  }
  list(): { id: string; path: string }[] {
    return [...this.map.entries()].map(([id, v]) => ({ id, path: v.path }));
  }
  set(wsId: string, v: { path: string; trusted: boolean; hydrated: boolean }): void {
    this.map.set(wsId, v);
  }
}

const initOk = (method: string): Promise<unknown> =>
  method === 'initialize' ? Promise.resolve({ capabilities: {} }) : Promise.resolve(null);

function harness(opts?: {
  behavior?: (method: string, params: unknown) => Promise<unknown>;
  available?: boolean;
  command?: string;
  requestTimeoutMs?: number;
  maxFileBytes?: number;
  maxDiagnostics?: number;
}) {
  const wsDir = mkdtempSync(join(tmpdir(), 'polydesk-lsp-'));
  const ws = new FakeWs();
  const lifecycle = new WorkspaceLifecycle();
  const children: FakeChild[] = [];
  const conns: FakeConn[] = [];
  const command = opts?.command ?? 'C:\\tools\\langserver.exe';
  const available = opts?.available ?? true;

  const spawn = vi.fn<LspSpawnFn>(() => {
    const c = new FakeChild(10000 + children.length);
    children.push(c);
    return c;
  });
  const treeKill = vi.fn();
  const emitDiagnostics = vi.fn();
  const behavior = opts?.behavior ?? initOk;

  const mgr = new LspManager(ws, lifecycle, {
    spawn,
    connect: () => {
      const conn = new FakeConn(behavior);
      conns.push(conn);
      return conn;
    },
    probe: (langId) => ({ langId, available, command: available ? command : undefined, installable: true }),
    emitDiagnostics,
    treeKill,
    requestTimeoutMs: opts?.requestTimeoutMs ?? 5_000,
    initTimeoutMs: 5_000,
    maxFileBytes: opts?.maxFileBytes ?? 5 * 1024 * 1024,
    maxDiagnostics: opts?.maxDiagnostics ?? 1_000,
  });

  return {
    mgr,
    ws,
    lifecycle,
    spawn,
    treeKill,
    emitDiagnostics,
    children,
    conns,
    wsDir,
    cleanup: () => rmSync(wsDir, { recursive: true, force: true }),
  };
}

/** 工作區內合法檔案 uri。 */
function uriIn(wsDir: string, rel: string): string {
  return pathToFileURL(join(wsDir, rel)).toString();
}

// ── A1 受信任閘門 ──
describe('LspManager 受信任閘門（F-5-A1 / REQ-SEC-003）', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.cleanup());

  it('未信任工作區開 .rs → child spawn 0 次、回降級（不擋編輯）', async () => {
    h.ws.set('ws1', { path: h.wsDir, trusted: false, hydrated: true });
    const res = await h.mgr.sync({
      wsId: 'ws1',
      langId: 'rust',
      uri: uriIn(h.wsDir, 'src/main.rs'),
      version: 1,
      kind: 'open',
      text: 'fn main() {}',
    });
    expect(res).toEqual({ ok: true }); // 降級但不報錯、不擋編輯
    expect(h.spawn).not.toHaveBeenCalled(); // 零點擊 RCE 被擋：未信任不 spawn
  });

  it('使用者確認信任後才 spawn；env 帶 GOTOOLCHAIN=local、command 為絕對路徑（非裸名）', async () => {
    h.ws.set('ws1', { path: h.wsDir, trusted: false, hydrated: true });
    await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: uriIn(h.wsDir, 'src/main.rs'), version: 1, kind: 'open', text: 'x' });
    expect(h.spawn).not.toHaveBeenCalled();

    // 信任後再開
    h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
    await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: uriIn(h.wsDir, 'src/main.rs'), version: 1, kind: 'open', text: 'x' });

    expect(h.spawn).toHaveBeenCalledTimes(1);
    const [command, args, spawnOpts] = h.spawn.mock.calls[0];
    expect(command).toBe('C:\\tools\\langserver.exe'); // 解析的絕對路徑
    expect(command).not.toBe('rust-analyzer'); // 絕不是裸名（A2 防 cwd 劫持的前提）
    expect(Array.isArray(args)).toBe(true);
    expect(spawnOpts.cwd).toBe(h.wsDir);
    expect(spawnOpts.env.GOTOOLCHAIN).toBe('local'); // A1：抑制 go toolchain 自動下載執行
  });

  it('伺服器不可用（probe available:false）→ 不 spawn、降級', async () => {
    const h2 = harness({ available: false });
    try {
      h2.ws.set('ws1', { path: h2.wsDir, trusted: true, hydrated: true });
      const res = await h2.mgr.sync({ wsId: 'ws1', langId: 'go', uri: uriIn(h2.wsDir, 'm.go'), version: 1, kind: 'open', text: 'x' });
      expect(res).toEqual({ ok: true });
      expect(h2.spawn).not.toHaveBeenCalled();
    } finally {
      h2.cleanup();
    }
  });
});

// ── A3 越權轉發 ──
describe('LspManager 越權轉發防禦（F-5-A3）', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
    h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
  });
  afterEach(() => h.cleanup());

  it('request method=workspace/executeCommand → 不轉發、回 error、不 spawn', async () => {
    const res = await h.mgr.request('ws1', 'rust', 'workspace/executeCommand', {
      command: 'rust-analyzer.runSingle',
      arguments: [],
    });
    expect(res).toEqual({ error: 'method-not-allowed' });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('唯讀方法白名單放行（completion）→ 進入轉發路徑（會 spawn）', async () => {
    const res = await h.mgr.request('ws1', 'rust', 'textDocument/completion', {
      textDocument: { uri: uriIn(h.wsDir, 'src/main.rs') },
      position: { line: 0, character: 0 },
    });
    expect('result' in res || 'error' in res).toBe(true);
    expect(h.spawn).toHaveBeenCalledTimes(1); // 白名單方法才會起伺服器
  });

  it('sync 工作區外 uri（絕對外部路徑）→ 不 didOpen、不 spawn', async () => {
    const outside = pathToFileURL('C:\\Windows\\System32\\evil.rs').toString();
    const res = await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: outside, version: 1, kind: 'open', text: 'x' });
    expect(res).toEqual({ ok: true });
    expect(h.spawn).not.toHaveBeenCalled(); // 越界 uri 在 spawn 前被擋
  });

  it('sync ../ 逃逸 uri → 被拒、不 spawn', async () => {
    const escape = pathToFileURL(join(h.wsDir, '..', 'secret.rs')).toString();
    const res = await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: escape, version: 1, kind: 'open', text: 'x' });
    expect(res).toEqual({ ok: true });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('request 用不屬於任何工作區的 wsId → 被拒（workspace-not-allowed）、不 spawn', async () => {
    const res = await h.mgr.request('ws-not-exist', 'rust', 'textDocument/hover', {
      textDocument: { uri: uriIn(h.wsDir, 'src/main.rs') },
    });
    expect(res).toEqual({ error: 'workspace-not-allowed' });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('request 帶工作區外 textDocument.uri → 被拒（uri-out-of-workspace）', async () => {
    const res = await h.mgr.request('ws1', 'rust', 'textDocument/definition', {
      textDocument: { uri: pathToFileURL('C:\\other\\x.rs').toString() },
      position: { line: 0, character: 0 },
    });
    expect(res).toEqual({ error: 'uri-out-of-workspace' });
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

// ── A5 卡死/teardown ──
describe('LspManager 卡死/teardown（F-5-A5 / REQ-WS-009）', () => {
  it('request 逾時 → reject/回 error（非永久 pending）', async () => {
    // initialize 正常回，但 feature request 永不回應
    const behavior = (method: string): Promise<unknown> =>
      method === 'initialize' ? Promise.resolve({ capabilities: {} }) : new Promise<unknown>(() => {});
    const h = harness({ behavior, requestTimeoutMs: 40 });
    try {
      h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
      const res = await h.mgr.request('ws1', 'rust', 'textDocument/hover', {
        textDocument: { uri: uriIn(h.wsDir, 'src/main.rs') },
        position: { line: 0, character: 0 },
      });
      expect(res).toEqual({ error: 'timeout' }); // 不靜默掛起
    } finally {
      h.cleanup();
    }
  });

  it('工作區 teardown → 對該 ws 的 LS tree-kill（含子程序）並移除', async () => {
    const h = harness();
    try {
      h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
      await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: uriIn(h.wsDir, 'a.rs'), version: 1, kind: 'open', text: 'x' });
      expect(h.spawn).toHaveBeenCalledTimes(1);
      expect(h.mgr.serverCount).toBe(1);
      const childPid = h.children[0].pid;

      await h.lifecycle.teardown('ws1');

      expect(h.treeKill).toHaveBeenCalledWith(childPid); // 殺整個 process tree
      expect(h.children[0].killed).toBeGreaterThanOrEqual(1);
      expect(h.mgr.serverCount).toBe(0);
    } finally {
      h.cleanup();
    }
  });

  it('同 (wsId, serverId) 多次開檔只 spawn 一個 LS（復用，避免殭屍堆積）', async () => {
    const h = harness();
    try {
      h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
      await h.mgr.sync({ wsId: 'ws1', langId: 'cpp', uri: uriIn(h.wsDir, 'a.cpp'), version: 1, kind: 'open', text: 'x' });
      // c 與 cpp 共用 clangd（同 serverId）→ 不應再 spawn
      await h.mgr.sync({ wsId: 'ws1', langId: 'c', uri: uriIn(h.wsDir, 'b.c'), version: 1, kind: 'open', text: 'y' });
      await h.mgr.sync({ wsId: 'ws1', langId: 'cpp', uri: uriIn(h.wsDir, 'c.cpp'), version: 1, kind: 'open', text: 'z' });
      expect(h.spawn).toHaveBeenCalledTimes(1);
      expect(h.mgr.serverCount).toBe(1);
    } finally {
      h.cleanup();
    }
  });

  it('spawn 後 child error → 清理降級（serverCount 歸零、不崩潰）', async () => {
    const h = harness();
    try {
      h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
      await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: uriIn(h.wsDir, 'a.rs'), version: 1, kind: 'open', text: 'x' });
      expect(h.mgr.serverCount).toBe(1);
      h.children[0].emitError(new Error('spawn EACCES'));
      expect(h.mgr.serverCount).toBe(0);
      expect(h.treeKill).toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });
});

// ── A4 巨檔降級 + diagnostics 數量截斷 ──
describe('LspManager 巨檔降級（F-5-A4）', () => {
  it('open 檔案 text 超過 maxFileBytes → 不啟 LSP（spawn 0 次、降級）', async () => {
    const h = harness({ maxFileBytes: 1024 }); // 1KB 門檻
    try {
      h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
      const huge = 'x'.repeat(2048); // > 門檻
      const res = await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: uriIn(h.wsDir, 'big.rs'), version: 1, kind: 'open', text: huge });
      expect(res).toEqual({ ok: true });
      expect(h.spawn).not.toHaveBeenCalled(); // 巨檔走 F-4 降級，不灌爆 main/LS
    } finally {
      h.cleanup();
    }
  });
});

describe('LspManager diagnostics 數量截斷（F-5-A4）', () => {
  it('伺服器吐巨量 diagnostics → emit 前截斷到上限', async () => {
    const h = harness({ maxDiagnostics: 5 });
    try {
      h.ws.set('ws1', { path: h.wsDir, trusted: true, hydrated: true });
      await h.mgr.sync({ wsId: 'ws1', langId: 'rust', uri: uriIn(h.wsDir, 'a.rs'), version: 1, kind: 'open', text: 'x' });
      const conn = h.conns[0];
      const huge = Array.from({ length: 500 }, (_, i) => ({ message: `e${i}`, range: {} }));
      conn.pushDiagnostics({ uri: uriIn(h.wsDir, 'a.rs'), diagnostics: huge });

      expect(h.emitDiagnostics).toHaveBeenCalledTimes(1);
      const payload = h.emitDiagnostics.mock.calls[0][0] as { wsId: string; diagnostics: unknown[] };
      expect(payload.wsId).toBe('ws1');
      expect(payload.diagnostics.length).toBe(5);
    } finally {
      h.cleanup();
    }
  });
});

// ── A4 Content-Length framing 上限（thin bridge reader 守門）──
function makeFrame(body: string): Buffer {
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8');
}

function pump(limiter: ContentLengthLimiter, input: Buffer): Promise<Buffer> {
  return new Promise((res) => {
    const out: Buffer[] = [];
    limiter.on('data', (c: Buffer) => out.push(c));
    limiter.on('error', () => {
      /* 違規時可能無 error；忽略 */
    });
    limiter.on('close', () => res(Buffer.concat(out)));
    limiter.on('end', () => res(Buffer.concat(out)));
    limiter.end(input);
  });
}

describe('parseContentLength（F-5-A4）', () => {
  it('取出合法長度（大小寫不敏感）', () => {
    expect(parseContentLength('Content-Length: 42\r\nFoo: bar')).toBe(42);
    expect(parseContentLength('content-length:7')).toBe(7);
  });
  it('缺 header → null', () => {
    expect(parseContentLength('X: 1')).toBeNull();
  });
  it('超大數字仍回該數值（供上限比較）', () => {
    expect(parseContentLength('Content-Length: 9999999999')).toBe(9999999999);
  });
});

describe('ContentLengthLimiter（F-5-A4：framing 上限守門）', () => {
  it('單一正常 frame 原樣轉送', async () => {
    const body = '{"jsonrpc":"2.0","id":1,"result":null}';
    const frame = makeFrame(body);
    const out = await pump(new ContentLengthLimiter(1024 * 1024, vi.fn()), frame);
    expect(out.equals(frame)).toBe(true);
  });

  it('兩個 frame 跨 chunk 邊界完整重組轉送', async () => {
    const both = Buffer.concat([makeFrame('{"a":1}'), makeFrame('{"b":2}')]);
    const limiter = new ContentLengthLimiter(1024 * 1024, vi.fn());
    const out = new Promise<Buffer>((res) => {
      const acc: Buffer[] = [];
      limiter.on('data', (c: Buffer) => acc.push(c));
      limiter.on('end', () => res(Buffer.concat(acc)));
    });
    limiter.write(both.subarray(0, 10));
    limiter.write(both.subarray(10));
    limiter.end();
    expect((await out).equals(both)).toBe(true);
  });

  it('宣稱超上限的 Content-Length → onViolation + 關閉串流，不配置該大小緩衝', async () => {
    const onViolation = vi.fn();
    const limiter = new ContentLengthLimiter(1024 * 1024, onViolation);
    const violated = new Promise<number>((res) => onViolation.mockImplementation((len: number) => res(len)));
    limiter.on('error', () => {});
    // 只送 header（宣稱 ~10GB），不送 body — 若先配置緩衝再讀 body 就會炸
    limiter.write(Buffer.from('Content-Length: 9999999999\r\n\r\n'));
    expect(await violated).toBe(9999999999);
    expect(onViolation).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(limiter.destroyed).toBe(true);
  });

  it('剛好等於上限放行；超過 1 byte 違規', async () => {
    const okOut = await pump(new ContentLengthLimiter(8, vi.fn()), Buffer.from('Content-Length: 8\r\n\r\n12345678'));
    expect(okOut.toString()).toContain('12345678');

    const onViolation = vi.fn();
    const bad = new ContentLengthLimiter(8, onViolation);
    bad.on('error', () => {});
    bad.write(Buffer.from('Content-Length: 9\r\n\r\n'));
    await new Promise((r) => setTimeout(r, 0));
    expect(onViolation).toHaveBeenCalledWith(9);
  });

  it('無分隔的超長 header（無 CRLFCRLF）→ 違規（不無界緩衝）', async () => {
    const onViolation = vi.fn();
    const limiter = new ContentLengthLimiter(1024 * 1024, onViolation);
    limiter.on('error', () => {});
    limiter.write(Buffer.from('Content-Length: '.padEnd(9000, 'A')));
    await new Promise((r) => setTimeout(r, 0));
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith(-1);
  });
});
