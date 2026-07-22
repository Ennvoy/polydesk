// 終端機 PTY 後端（F-3：REQ-TERM-001~008、REQ-WS-005/009、REQ-PERF-004）。
// 以 node-pty spawn 真實 shell（encoding:null → Buffer），高頻輸出經 frame 批次合併 +
// flow control（pause/resume）送往 renderer；輸入經 PTY_WRITE 寫回（write/resize/close 全帶
// 存在性 + alive 守衛，避免關閉時序競態打爆 main，REQ-NFR-002）。
//
// 安全硬化：
//  - shell 嚴格查表（固定 Record<ShellKind,string>）；未知值/非法 wsId 一律 throw、絕不把
//    caller 字串當執行檔 spawn（防 RCE，F-3-A1）。
//  - PTY 輸出攔截 OSC 52（REQ-TERM-008，F-3-A2，X-4 稽核；2026-07-02 使用者拍板放寬）：
//    「寫入」解出 payload 交 main 寫系統剪貼簿（有大小上限；Claude Code 等 TUI 的選取複製靠此，
//    對齊 Windows Terminal/VS Code 行為）；「讀取/查詢」（`?`）一律丟棄不回應（防剪貼簿外洩，
//    這才是危險方向）；序列本體一律不進 renderer。
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

// ── shell 啟動參數（UTF-8 對齊；參數來自固定查表，不採 caller 字串，維持 A1 不變式）──
// Windows zh-TW 的 PowerShell 5.1 / cmd.exe 預設輸出 cp950(Big5) bytes，而 xterm 一律以 UTF-8 解碼
// （node-pty encoding:null 原樣傳 Buffer）→ 中文必亂碼。故為這兩者注入 `chcp 65001`（切 console code page
// 為 UTF-8）啟動序列，讓 shell 改吐 UTF-8 bytes、對上 xterm 的解碼（已實測：PowerShell 5.1 的 cmdlet 中文
// 輸出經此即為 UTF-8、不亂碼）。設定指令以 >$null/>nul 抑制回顯（畫面乾淨）；powershell 另帶 -NoLogo 略過版權
// 橫幅、-NoExit 保留互動。pwsh(7+)/gitbash/wsl 預設已 UTF-8 → 回空陣列免動。
// 刻意「不」用 [Console]::OutputEncoding=UTF8：在 ConPTY 下設定 .NET console 編碼會與 node-pty 的 conpty
// console agent 衝突（實測使測試 worker ERR_IPC_CHANNEL_CLOSED 崩潰）；chcp 已足夠且穩定。
/** 解析 ShellKind → 啟動參數（固定查表）。只有 powershell/cmd 需 UTF-8 初始化（chcp 65001），其餘回 []。 */
export function resolveShellArgs(shell: ShellKind): string[] {
  switch (shell) {
    case 'powershell':
      return ['-NoLogo', '-NoExit', '-Command', 'chcp 65001 > $null'];
    case 'cmd':
      return ['/K', 'chcp 65001 >nul'];
    case 'pwsh':
    case 'gitbash':
    case 'wsl':
      return [];
  }
}

// ── OSC 52 攔截（寫入→解出交剪貼簿；查詢→丟棄不回應），REQ-TERM-008 / F-3-A2 ──
const ESC = 0x1b;
const BEL = 0x07;
const OSC = 0x5d; // ']'
const ST_BACKSLASH = 0x5c; // '\'
/** 單次 OSC52 寫入的 base64 payload 上限（約 1.5MB 純文字）；超過＝可疑灌爆，丟棄不寫。 */
export const OSC52_WRITE_MAX_B64 = 2 * 1024 * 1024;
/** 未終止的 OSC52 carry 上限（≥ 完整寫入序列），防無界緩衝 DoS。 */
export const OSC52_CARRY_CAP = OSC52_WRITE_MAX_B64 + 256;

/** 嘗試自 esc 起匹配 `ESC ] 5 2 ;` … 終止（BEL 或 ESC\）；命中回傳序列終點與內文（`<Pc>;<Pd>`）邊界。 */
function matchOsc52(
  buf: Buffer,
  esc: number,
): { end: number; bodyStart: number; bodyEnd: number } | 'incomplete' | null {
  // 需至少 "\x1b]52;" 5 個 byte 才能確認是 OSC52
  const want = [ESC, OSC, 0x35, 0x32, 0x3b]; // ESC ] 5 2 ;
  for (let k = 0; k < want.length; k++) {
    const idx = esc + k;
    if (idx >= buf.length) return 'incomplete'; // 是 OSC52 前綴但被切斷
    if (buf[idx] !== want[k]) return null; // 非 OSC52
  }
  const bodyStart = esc + want.length;
  // 找終止序列
  for (let i = bodyStart; i < buf.length; i++) {
    if (buf[i] === BEL) return { end: i + 1, bodyStart, bodyEnd: i };
    if (buf[i] === ESC && i + 1 < buf.length && buf[i + 1] === ST_BACKSLASH) return { end: i + 2, bodyStart, bodyEnd: i };
    if (buf[i] === ESC) return 'incomplete'; // 終止序列首字被切斷
  }
  return 'incomplete';
}

/**
 * 解析 OSC52 內文 `<selection>;<base64>` → 寫入文字。查詢（`?`＝請終端機回報剪貼簿，
 * 剪貼簿外洩方向）、缺分號、超上限、base64 解不出東西 → 一律 null（不寫）。
 */
function parseOsc52Write(body: Buffer): string | null {
  const sep = body.indexOf(0x3b); // ';'
  if (sep === -1) return null;
  const pd = body.subarray(sep + 1);
  if (pd.length === 0 || pd.length > OSC52_WRITE_MAX_B64) return null;
  if (pd.length === 1 && pd[0] === 0x3f) return null; // '?' 查詢：封死不回應
  const text = Buffer.from(pd.toString('latin1'), 'base64').toString('utf8');
  return text.length > 0 ? text : null;
}

/**
 * 自 PTY 輸出攔下 OSC 52 序列（一律不進 renderer）；跨 chunk 邊界以 carry 接續（有上限）。
 * 寫入型序列解出的文字收進 `writes`（呼叫端負責寫系統剪貼簿）；查詢型丟棄。純函式、可單測。
 */
export function stripOsc52(
  input: Buffer,
  carry: Buffer = Buffer.alloc(0),
): { output: Buffer; carry: Buffer; writes: string[] } {
  const data = carry.length ? Buffer.concat([carry, input]) : input;
  const out: Buffer[] = [];
  const writes: string[] = [];
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
        return { output: Buffer.concat(out), carry: Buffer.alloc(0), writes };
      }
      return { output: Buffer.concat(out), carry: Buffer.from(tail), writes };
    }
    const w = parseOsc52Write(data.subarray(m.bodyStart, m.bodyEnd));
    if (w !== null) writes.push(w);
    i = m.end; // 完整 OSC52 → 序列本體一律丟棄（不進 renderer）
  }
  return { output: Buffer.concat(out), carry: Buffer.alloc(0), writes };
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
  /** 殺整個 process tree（Windows: taskkill /PID <pid> /T /F）；回傳 promise 者於 kill 完成時 resolve。 */
  treeKill?: (pid: number) => void | Promise<void>;
  /** frame 批次合併間隔（ms），預設 16（約一幀）。 */
  flushIntervalMs?: number;
  /** 待送 byte 超過此門檻即 pause() backpressure，預設 1MB。 */
  highWaterBytes?: number;
  /** 是否攔截 OSC52（REQ-TERM-008：寫入解出交剪貼簿、查詢丟棄、序列不進 renderer），預設開。 */
  stripClipboard?: boolean;
  /** OSC52 寫入的實際落地（預設 electron clipboard；unit test 於純 node 環境注入 spy）。 */
  writeClipboard?: (text: string) => void;
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
  /** 最後「實際套用成功」的 PTY 尺寸（resize 去重基準；失敗不記帳 → 下次重送自動重試）。 */
  appliedCols: number;
  appliedRows: number;
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

function defaultTreeKill(pid: number): void | Promise<void> {
  if (process.platform === 'win32') {
    // 回傳 promise 讓 app 關閉路徑 await 到 taskkill 真的跑完——否則 app.exit 先到、shell 變孤兒。
    return new Promise<void>((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()); // best-effort：程序可能已自行結束
    });
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* 已結束 */
  }
}

function toBuffer(d: Buffer | string): Buffer {
  return typeof d === 'string' ? Buffer.from(d, 'utf8') : d;
}

// 動態 import：本模組的純函式（stripOsc52 等）要能在純 node 環境單測，不可 top-level
// 執行期 import electron；只有真的發生 OSC52 寫入時才觸碰 electron。
const defaultWriteClipboard = (text: string): void => {
  void import('electron').then(({ clipboard }) => clipboard.writeText(text)).catch(() => undefined);
};

export class PtyManager {
  private readonly terms = new Map<string, Term>();
  private readonly spawn: SpawnFn;
  private readonly emitData: (p: { termId: string; chunk: Uint8Array }) => void;
  private readonly emitExit: (p: { termId: string; exitCode: number }) => void;
  private readonly treeKill: (pid: number) => void | Promise<void>;
  private readonly flushIntervalMs: number;
  private readonly highWaterBytes: number;
  private readonly stripClipboard: boolean;
  private readonly writeClipboard: (text: string) => void;

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
    this.writeClipboard = deps.writeClipboard ?? defaultWriteClipboard;
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
    const p = this.spawn(file, resolveShellArgs(shell), {
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
      appliedCols: 80,
      appliedRows: 24,
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

  /** 調整尺寸；termId 不存在/已死則安全 no-op（F-3-A4）。
   *  去重以「實際套用成功」的尺寸為準：renderer 每次 fit 都重送，同尺寸在此擋下（不打擾 ConPTY）；
   *  resize 失敗「不」記帳 → 下一次重送自動重試——避免 PTY↔xterm 行數一次失敗永久漂移
   *  （漂移＝claude 等 TUI 把底部 UI 畫在不存在的列上，dogfood 回報「展開時最下方被擋」）。 */
  resize(req: { termId: string; cols: number; rows: number }): {
    ok: true;
    applied: boolean;
    cols: number;
    rows: number;
  } {
    const t = this.terms.get(req.termId);
    if (t && t.alive) {
      const cols = Math.max(1, req.cols | 0);
      const rows = Math.max(1, req.rows | 0);
      if (cols !== t.appliedCols || rows !== t.appliedRows) {
        try {
          t.pty.resize(cols, rows);
          t.appliedCols = cols;
          t.appliedRows = rows;
        } catch {
          /* 競態/ConPTY 失敗：applied 保持舊值，下次重送重試 */
        }
      }
      return {
        ok: true,
        applied: t.appliedCols === cols && t.appliedRows === rows,
        cols: t.appliedCols,
        rows: t.appliedRows,
      };
    }
    return { ok: true, applied: false, cols: 0, rows: 0 } as const;
  }

  /** 關閉並刪除 PTY；對已刪/已死 termId 冪等回 {ok:true}（F-3-A4）。 */
  close(req: { termId: string }): { ok: true } {
    const t = this.terms.get(req.termId);
    if (!t) return { ok: true } as const;
    void this.disposeTerm(req.termId, t); // 互動關閉不等 tree kill（teardown 路徑才 await）
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

  /** teardown：殺該 wsId 所有 pty（含子程序樹）並移除（REQ-WS-009）；resolve 於所有 tree kill 完成。 */
  killWorkspace(wsId: string): Promise<void> {
    const kills: Promise<void>[] = [];
    for (const [termId, t] of [...this.terms]) {
      if (t.wsId === wsId) kills.push(this.disposeTerm(termId, t));
    }
    return Promise.all(kills).then(() => undefined);
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
        // OSC52 寫入落地系統剪貼簿（使用者拍板放寬：TUI 選取複製；查詢已在解析層丟棄）
        for (const w of r.writes) this.writeClipboard(w);
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

  /** 殺 pty（含子程序樹）+ 清理 + 自 Map 移除；resolve 於 tree kill 完成（app 關閉路徑 await 用）。 */
  private disposeTerm(termId: string, t: Term): Promise<void> {
    if (t.flushTimer !== null) {
      clearTimeout(t.flushTimer);
      t.flushTimer = null;
    }
    t.alive = false;
    const pid = t.pty.pid;
    let killed: void | Promise<void> = undefined;
    if (typeof pid === 'number' && pid > 0) {
      try {
        killed = this.treeKill(pid);
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
    return Promise.resolve(killed).then(
      () => undefined,
      () => undefined,
    );
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
