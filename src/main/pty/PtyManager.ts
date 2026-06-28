// 終端機 PTY 後端（F-3：REQ-TERM-001~008、REQ-WS-005/009、REQ-PERF-004）。
// 以 node-pty spawn 真實 shell（encoding:null → Buffer），高頻輸出經 frame 批次合併 +
// flow control（pause/resume）送往 renderer；輸入經 PTY_WRITE 寫回（write/resize/close 全帶
// 存在性 + alive 守衛，避免關閉時序競態打爆 main，REQ-NFR-002）。
//
// 安全硬化：
//  - shell 嚴格查表（固定 Record<ShellKind,string>）；未知值/非法 wsId 一律 throw、絕不把
//    caller 字串當執行檔 spawn（防 RCE，F-3-A1）。
//  - PTY 輸出預設過濾 OSC 52（剪貼簿寫入），對齊 REQ-TERM-008（F-3-A2，best-effort，X-4 稽核）。
//  - teardown 殺整個 process tree（Windows taskkill /T），避免殭屍子程序（REQ-WS-009、F-3-A6）。

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import * as pty from 'node-pty';
import type { IpcMain } from 'electron';
import { emit, emitRaw } from '../ipc/broadcast';
import { PTY_DATA, PTY_WRITE } from '../../shared/channels';
import { sanitizeUserEnv } from '../security/spawnEnv';
import type { ShellKind, TermState } from '../../shared/types';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';

// ── shell allowlist（固定查表；caller 字串絕不入 spawn，F-3-A1）──
export const GIT_BASH_PATH = 'C:\\Program Files\\Git\\bin\\bash.exe';
export const VALID_SHELLS: readonly ShellKind[] = ['powershell', 'cmd', 'pwsh', 'gitbash', 'wsl'];

export function isShellKind(x: unknown): x is ShellKind {
  return typeof x === 'string' && (VALID_SHELLS as readonly string[]).includes(x);
}

/** 解析 ShellKind → 寫死的執行檔（gitbash 只在兩個寫死絕對路徑間選，不採 caller 字串）。 */
export function resolveShellFile(shell: ShellKind): string {
  switch (shell) {
    case 'powershell':
      return 'powershell.exe';
    case 'cmd':
      return 'cmd.exe';
    case 'pwsh':
      return 'pwsh.exe';
    case 'wsl':
      return 'wsl.exe';
    case 'gitbash':
      return existsSync(GIT_BASH_PATH) ? GIT_BASH_PATH : 'bash.exe';
  }
}

// ── OSC 52 過濾（剪貼簿寫入），REQ-TERM-008 / F-3-A2 ──
const ESC = 0x1b;
const BEL = 0x07;
const OSC = 0x5d; // ']'
const ST_BACKSLASH = 0x5c; // '\'
const OSC52_CARRY_CAP = 4096; // 未終止的 OSC52 carry 上限，防無界緩衝 DoS

/** 嘗試自 esc 起匹配 `ESC ] 5 2 ;` … 終止（BEL 或 ESC\）。 */
function matchOsc52(buf: Buffer, esc: number): { end: number } | 'incomplete' | null {
  // 需至少 "\x1b]52;" 5 個 byte 才能確認是 OSC52
  const want = [ESC, OSC, 0x35, 0x32, 0x3b]; // ESC ] 5 2 ;
  for (let k = 0; k < want.length; k++) {
    const idx = esc + k;
    if (idx >= buf.length) return 'incomplete'; // 是 OSC52 前綴但被切斷
    if (buf[idx] !== want[k]) return null; // 非 OSC52
  }
  // 找終止序列
  for (let i = esc + want.length; i < buf.length; i++) {
    if (buf[i] === BEL) return { end: i + 1 };
    if (buf[i] === ESC && i + 1 < buf.length && buf[i + 1] === ST_BACKSLASH) return { end: i + 2 };
    if (buf[i] === ESC) return 'incomplete'; // 終止序列首字被切斷
  }
  return 'incomplete';
}

/**
 * 自 PTY 輸出移除 OSC 52（剪貼簿寫入）序列；跨 chunk 邊界以 carry 接續（有上限）。
 * 回傳乾淨輸出 + 下次需接續的 carry（不含 OSC52 以外資料）。純函式、可單測。
 */
export function stripOsc52(input: Buffer, carry: Buffer = Buffer.alloc(0)): { output: Buffer; carry: Buffer } {
  const data = carry.length ? Buffer.concat([carry, input]) : input;
  const out: Buffer[] = [];
  let i = 0;
  while (i < data.length) {
    const esc = data.indexOf(ESC, i);
    if (esc === -1) {
      out.push(data.subarray(i));
      break;
    }
    if (esc > i) out.push(data.subarray(i, esc));
    const m = matchOsc52(data, esc);
    if (m === null) {
      out.push(data.subarray(esc, esc + 1)); // 保留這個 ESC，從下一 byte 續掃
      i = esc + 1;
      continue;
    }
    if (m === 'incomplete') {
      const tail = data.subarray(esc);
      if (tail.length > OSC52_CARRY_CAP) {
        out.push(tail); // 超過上限：放棄當作 OSC52，原樣輸出（防無界 carry）
        return { output: Buffer.concat(out), carry: Buffer.alloc(0) };
      }
      return { output: Buffer.concat(out), carry: Buffer.from(tail) };
    }
    i = m.end; // 命中完整 OSC52 → 丟棄
  }
  return { output: Buffer.concat(out), carry: Buffer.alloc(0) };
}

// ── 抽象出 PtyManager 實際用到的 pty 介面（node-pty IPty 相容；測試可注入 fake）──
export interface ManagedPty {
  readonly pid: number;
  readonly process?: string;
  onData(cb: (data: Buffer | string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  resize(cols: number, rows: number): void;
  write(data: string): void;
  kill(signal?: string): void;
  pause(): void;
  resume(): void;
}

export type SpawnFn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; encoding: null },
) => ManagedPty;

export interface PtyDeps {
  spawn?: SpawnFn;
  emitData?: (payload: { termId: string; chunk: Uint8Array }) => void;
  emitExit?: (payload: { termId: string; exitCode: number }) => void;
  /** 殺整個 process tree（Windows: taskkill /PID <pid> /T /F）。 */
  treeKill?: (pid: number) => void;
  /** frame 批次合併間隔（ms），預設 16（約一幀）。 */
  flushIntervalMs?: number;
  /** 待送 byte 超過此門檻即 pause() backpressure，預設 1MB。 */
  highWaterBytes?: number;
  /** 是否過濾 OSC52（REQ-TERM-008），預設開。 */
  stripClipboard?: boolean;
}

export class PtyError extends Error {
  constructor(public readonly code: 'invalid-shell' | 'no-workspace') {
    super(`[Polydesk] pty:create 失敗：${code}`);
    this.name = 'PtyError';
  }
}

interface Term {
  pty: ManagedPty;
  wsId: string;
  shell: ShellKind;
  title: string;
  alive: boolean;
  exitCode?: number;
  pending: Buffer[];
  pendingBytes: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  paused: boolean;
  osc52Carry: Buffer;
  onDataDisposable: { dispose(): void } | null;
  onExitDisposable: { dispose(): void } | null;
}

const defaultSpawn: SpawnFn = (file, args, opts) =>
  pty.spawn(file, args, opts) as unknown as ManagedPty;

function defaultTreeKill(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {
      /* best-effort：程序可能已自行結束 */
    });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 已結束 */
    }
  }
}

function toBuffer(d: Buffer | string): Buffer {
  return typeof d === 'string' ? Buffer.from(d, 'utf8') : d;
}

export class PtyManager {
  private readonly terms = new Map<string, Term>();
  private readonly spawn: SpawnFn;
  private readonly emitData: (p: { termId: string; chunk: Uint8Array }) => void;
  private readonly emitExit: (p: { termId: string; exitCode: number }) => void;
  private readonly treeKill: (pid: number) => void;
  private readonly flushIntervalMs: number;
  private readonly highWaterBytes: number;
  private readonly stripClipboard: boolean;

  constructor(
    private readonly workspaces: WorkspaceManager,
    lifecycle: WorkspaceLifecycle,
    deps: PtyDeps = {},
  ) {
    this.spawn = deps.spawn ?? defaultSpawn;
    this.emitData = deps.emitData ?? ((p) => emitRaw(PTY_DATA, p));
    this.emitExit = deps.emitExit ?? ((p) => emit('pty:exit', p));
    this.treeKill = deps.treeKill ?? defaultTreeKill;
    this.flushIntervalMs = deps.flushIntervalMs ?? 16;
    this.highWaterBytes = deps.highWaterBytes ?? 1024 * 1024;
    this.stripClipboard = deps.stripClipboard ?? true;
    // 移除工作區 / 關 app → 殺該 wsId 所有 pty（含子程序樹），避免殭屍（REQ-WS-009）。
    lifecycle.register('pty', (wsId) => this.killWorkspace(wsId));
  }

  /** 建立 PTY（嚴格驗證 shell + 工作區，否則 throw → renderer invoke reject）。 */
  create(req: { wsId: string; shell: ShellKind }): { termId: string } {
    const { wsId, shell } = req;
    if (!isShellKind(shell)) throw new PtyError('invalid-shell');
    const ws = this.workspaces.get(wsId);
    if (!ws || ws.status !== 'ok') throw new PtyError('no-workspace');

    const file = resolveShellFile(shell);
    const p = this.spawn(file, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: ws.path,
      // REQ-SEC-002：使用者 shell 保留其完整環境，只剔除 Electron/Node 注入向量
      // （ELECTRON_RUN_AS_NODE/NODE_OPTIONS），避免 shell rc/profile 自動執行碼濫用。
      env: sanitizeUserEnv(),
      encoding: null,
    });

    const termId = randomUUID();
    const term: Term = {
      pty: p,
      wsId,
      shell,
      title: shell,
      alive: true,
      pending: [],
      pendingBytes: 0,
      flushTimer: null,
      paused: false,
      osc52Carry: Buffer.alloc(0),
      onDataDisposable: null,
      onExitDisposable: null,
    };
    this.terms.set(termId, term);
    term.onDataDisposable = p.onData((d) => this.onData(termId, toBuffer(d)));
    term.onExitDisposable = p.onExit(({ exitCode }) => this.onExit(termId, exitCode));
    return { termId };
  }

  /** renderer→main 高頻輸入；termId 不存在/已死則安全 no-op（F-3-A4）。 */
  write(termId: string, data: string): void {
    const t = this.terms.get(termId);
    if (!t || !t.alive) return;
    try {
      t.pty.write(data);
    } catch {
      /* 寫入競態（程序剛結束）：忽略，不讓 main 崩潰 */
    }
  }

  /** 調整尺寸；termId 不存在/已死則安全 no-op（F-3-A4）。 */
  resize(req: { termId: string; cols: number; rows: number }): { ok: true } {
    const t = this.terms.get(req.termId);
    if (t && t.alive) {
      try {
        t.pty.resize(Math.max(1, req.cols | 0), Math.max(1, req.rows | 0));
      } catch {
        /* 競態：忽略 */
      }
    }
    return { ok: true } as const;
  }

  /** 關閉並刪除 PTY；對已刪/已死 termId 冪等回 {ok:true}（F-3-A4）。 */
  close(req: { termId: string }): { ok: true } {
    const t = this.terms.get(req.termId);
    if (!t) return { ok: true } as const;
    this.disposeTerm(req.termId, t);
    return { ok: true } as const;
  }

  /** 列出某 wsId 的終端機（title 取即時前景程序名）。 */
  list(wsId: string): TermState[] {
    const out: TermState[] = [];
    for (const [termId, t] of this.terms) {
      if (t.wsId !== wsId) continue;
      let title = t.title;
      try {
        if (t.alive && t.pty.process) title = t.pty.process;
      } catch {
        /* 取不到沿用舊值 */
      }
      out.push({ termId, wsId: t.wsId, shell: t.shell, title, alive: t.alive });
    }
    return out;
  }

  /** 該 wsId 是否有 alive 的 pty（供 CloseConfirm 判斷，pragmatic）。 */
  hasRunningProcesses(wsId: string): boolean {
    for (const t of this.terms.values()) if (t.wsId === wsId && t.alive) return true;
    return false;
  }

  /** alive 終端機清單（供關閉前列示）。 */
  runningTerminals(wsId: string): TermState[] {
    return this.list(wsId).filter((t) => t.alive);
  }

  /** 該 wsId 所有 alive pty 的 root pid（供 F-8 ClaudeStatusMonitor 探測 PTY 下的 claude 子程序）。 */
  pidsOf(wsId: string): number[] {
    const out: number[] = [];
    for (const t of this.terms.values()) {
      if (t.wsId === wsId && t.alive) {
        try {
          out.push(t.pty.pid);
        } catch {
          /* pid 取不到略過 */
        }
      }
    }
    return out;
  }

  /** teardown：殺該 wsId 所有 pty（含子程序樹）並移除（REQ-WS-009）。 */
  killWorkspace(wsId: string): void {
    for (const [termId, t] of [...this.terms]) {
      if (t.wsId === wsId) this.disposeTerm(termId, t);
    }
  }

  // ── 內部 ──

  private onData(termId: string, chunk: Buffer): void {
    const t = this.terms.get(termId);
    if (!t) return;
    t.pending.push(chunk);
    t.pendingBytes += chunk.length;
    if (t.pendingBytes >= this.highWaterBytes && !t.paused) {
      try {
        t.pty.pause();
        t.paused = true;
      } catch {
        /* 忽略 */
      }
    }
    if (t.flushTimer === null) {
      t.flushTimer = setTimeout(() => this.flush(termId), this.flushIntervalMs);
    }
  }

  private flush(termId: string): void {
    const t = this.terms.get(termId);
    if (!t) return;
    t.flushTimer = null;
    if (t.pending.length > 0) {
      let buf: Buffer = Buffer.concat(t.pending);
      t.pending = [];
      t.pendingBytes = 0;
      if (this.stripClipboard) {
        const r = stripOsc52(buf, t.osc52Carry);
        t.osc52Carry = r.carry;
        buf = r.output;
      }
      if (buf.length > 0) this.emitData({ termId, chunk: buf });
    }
    if (t.paused) {
      try {
        t.pty.resume();
        t.paused = false;
      } catch {
        /* 忽略 */
      }
    }
  }

  private onExit(termId: string, exitCode: number): void {
    const t = this.terms.get(termId);
    if (!t) return;
    if (t.flushTimer !== null) {
      clearTimeout(t.flushTimer);
      t.flushTimer = null;
    }
    this.flush(termId); // 沖出殘留輸出
    t.alive = false;
    t.exitCode = exitCode;
    this.emitExit({ termId, exitCode }); // 保留 Map 項（alive=false）供 UI 顯示「重啟」
  }

  /** 殺 pty（含子程序樹）+ 清理 + 自 Map 移除。 */
  private disposeTerm(termId: string, t: Term): void {
    if (t.flushTimer !== null) {
      clearTimeout(t.flushTimer);
      t.flushTimer = null;
    }
    t.alive = false;
    const pid = t.pty.pid;
    if (typeof pid === 'number' && pid > 0) {
      try {
        this.treeKill(pid);
      } catch {
        /* best-effort */
      }
    }
    try {
      t.pty.kill();
    } catch {
      /* 程序可能已被 treeKill 殺掉 */
    }
    t.onDataDisposable?.dispose();
    t.onExitDisposable?.dispose();
    this.terms.delete(termId);
  }
}

/**
 * 註冊 pty:* IPC（取代 stub）。router 改呼：
 *   registerPtyHandlers(ipcMain, services.workspaces, services.lifecycle)
 */
export function registerPtyHandlers(
  ipc: IpcMain,
  workspaces: WorkspaceManager,
  lifecycle: WorkspaceLifecycle,
): PtyManager {
  const mgr = new PtyManager(workspaces, lifecycle);

  ipc.handle('pty:create', (_e, req: { wsId: string; shell: ShellKind }) => mgr.create(req));
  ipc.handle('pty:resize', (_e, req: { termId: string; cols: number; rows: number }) => mgr.resize(req));
  ipc.handle('pty:close', (_e, req: { termId: string }) => mgr.close(req));
  ipc.handle('pty:list', (_e, req: { wsId: string }) => mgr.list(req.wsId));

  // 高頻輸入走 ipcMain.on（非 handle）；守衛在 mgr.write 內（F-3-A4）。
  ipc.on(PTY_WRITE, (_e, payload: { termId: string; data: string }) => {
    if (payload && typeof payload.termId === 'string' && typeof payload.data === 'string') {
      mgr.write(payload.termId, payload.data);
    }
  });

  return mgr;
}
