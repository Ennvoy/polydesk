// 程序探測（F-8：REQ-MON-001/002）。唯讀觀察 OS 程序樹，判斷某工作區 shell 子樹下是否有 claude
// 在跑、其下是否還有子程序（＝正在跑工具）。**不控制 Claude**。
//
// 安全硬化（紅軍 F-8-A1，與 F-3-A1 同型：唯讀監控路徑、無使用者互動即觸發的零點擊 RCE）：
//   - 一律以「絕對路徑」spawn 系統 powershell.exe（%SystemRoot%\System32\WindowsPowerShell\v1.0\），
//     絕不 bare name 'powershell'（Windows CreateProcess 搜尋順序會先吃 cwd → 半可信 workspace 根放
//     powershell.exe 即被以 main 權限執行）。
//   - shell:false、argv 陣列（caller/工作區字串永不進 shell）。
//   - cwd 固定為系統安全目錄（systemRoot），絕不落在任何 workspace.path。
//   - env 為白名單最小集（只留 SystemRoot/windir/PATHEXT），剔除 GIT_* / 接線機密 / 任意繼承變數。
//   - 子程序自帶逾時 kill（WMI 倉庫故障 hang 不會卡死探測；REQ-MON-006 資源有界）。
//
// 分類強韌性（紅軍 F-8-A2/A3/A5）：
//   - Win32_Process.CommandLine 對 System/Idle(PID 0,4) 與無權讀的程序一律回 null；name 亦可能缺。
//     matchClaude 對 null/缺欄一律當「不匹配」、絕不丟例外（單點故障防護 REQ-NFR-002）。
//   - 比對綁「root pid 子樹」＋ claude 為可執行 token（argv0 / name 結尾），不認全機任意改名 claude.exe、
//     不被 'node claude-x.js' / 'C:\claude\app.exe' / 'git commit -m "fix claude"' 等良性子字串誤判。

import { spawn as nodeSpawn } from 'node:child_process';
import * as path from 'node:path';

/** 單一程序紀錄。name/cmd 可能為 null（System/Idle、無權讀程序），呼叫端須容忍。 */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string | null;
  cmd: string | null;
}

/** matchClaude 結果：root 子樹中的 claude pids，以及 claude 之下是否仍有子程序（＝正在跑工具）。 */
export interface ClaudeProbeResult {
  claudePids: number[];
  hasActiveChildren: boolean;
}

/** 列舉全機程序表的注入點（預設真實 powershell 版；測試傳入受控清單跑真實樹演算法）。 */
export type ProcessLister = () => Promise<ProcessInfo[]>;

/** spawn 子程序最小介面（測試以 spy/fake 取代真實 child_process）。 */
export interface ProbeChildProcess {
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}
export interface ProbeSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  shell: false;
}
export type ProbeSpawnFn = (
  file: string,
  args: readonly string[],
  options: ProbeSpawnOptions,
) => ProbeChildProcess;

/** 探測子程序逾時（WMI hang 防卡死）。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 6_000;

const defaultSpawn: ProbeSpawnFn = (file, args, options) =>
  nodeSpawn(file, [...args], options) as unknown as ProbeChildProcess;

/** PowerShell 列舉指令（-NoProfile 防 profile 挾持；ConvertTo-Json 結構化輸出）。 */
const PS_ARGS: readonly string[] = [
  '-NoProfile',
  '-NonInteractive',
  '-NoLogo',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  "$ErrorActionPreference='SilentlyContinue'; " +
    'Get-CimInstance Win32_Process | ' +
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine | ' +
    'ConvertTo-Json -Compress -Depth 2',
];

/** 解析 systemRoot（環境缺值時退回 C:\Windows）。 */
export function resolveSystemRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.SystemRoot || env.windir || 'C:\\Windows';
}

/** 系統 powershell.exe 絕對路徑（絕不 bare name；F-8-A1）。 */
export function powershellAbsolutePath(systemRoot: string): string {
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** 探測子程序的白名單最小 env（剔除 GIT_* / 接線機密 / 任意繼承變數；F-8-A1）。 */
export function safeProbeEnv(systemRoot: string): NodeJS.ProcessEnv {
  return {
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
  };
}

export interface ProcessListerOptions {
  spawn?: ProbeSpawnFn;
  systemRoot?: string;
  /** 安全 cwd（預設 systemRoot；絕不傳 workspace.path）。 */
  cwd?: string;
  timeoutMs?: number;
}

/**
 * 解析 ConvertTo-Json 輸出 → ProcessInfo[]。單一程序時 PowerShell 回物件、多個回陣列，皆容忍。
 * 缺/壞欄位一律降級（pid 缺 → 跳過；name/cmd 非字串 → null）。永不丟例外。
 */
export function parseProcessJson(raw: string): ProcessInfo[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const arr = Array.isArray(data) ? data : [data];
  const out: ProcessInfo[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const pid = toFiniteNumber(rec.ProcessId);
    if (pid === null) continue;
    out.push({
      pid,
      ppid: toFiniteNumber(rec.ParentProcessId) ?? 0,
      name: typeof rec.Name === 'string' ? rec.Name : null,
      cmd: typeof rec.CommandLine === 'string' ? rec.CommandLine : null,
    });
  }
  return out;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * 建一個「真實 powershell 版」程序列舉器：絕對路徑 + shell:false + 固定安全 cwd + 白名單 env + 逾時 kill。
 * 子程序逾時/spawn 失敗（ENOENT）/解析失敗皆 reject（呼叫端據此降級沿用上次，不假裝成功）。
 */
export function createProcessLister(opts: ProcessListerOptions = {}): ProcessLister {
  const spawnFn = opts.spawn ?? defaultSpawn;
  const systemRoot = opts.systemRoot ?? resolveSystemRoot();
  const file = powershellAbsolutePath(systemRoot);
  const cwd = opts.cwd ?? systemRoot;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  return () =>
    new Promise<ProcessInfo[]>((resolve, reject) => {
      let settled = false;
      const chunks: Buffer[] = [];
      const child = spawnFn(file, PS_ARGS, {
        cwd,
        env: safeProbeEnv(systemRoot),
        windowsHide: true,
        shell: false,
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {
          /* 程序可能已自行結束 */
        }
        reject(new Error('[Polydesk] processProbe 逾時'));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      child.stdout?.on('data', (d: Buffer) => {
        chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d)));
      });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error('[Polydesk] processProbe spawn 失敗'));
      });
      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(parseProcessJson(Buffer.concat(chunks).toString('utf8')));
      });
    });
}

/** 預設真實列舉器（router / ClaudeStatusMonitor 預設使用）。 */
export const defaultProcessLister: ProcessLister = createProcessLister();

// ── 分類演算法（純函式；F-8-A2/A3/A5）──

/** claude 可執行檔名/結尾 token：claude / claude.exe / claude.cmd（路徑分隔或字首為界，結尾錨定）。 */
const CLAUDE_EXE = /(^|[\\/])claude(\.exe|\.cmd)?$/i;

/** 取命令列 argv[0]（處理引號包裹的執行檔路徑）。 */
function firstToken(cmd: string): string {
  const s = cmd.replace(/^\s+/, '');
  if (s.charCodeAt(0) === 0x22 /* " */) {
    const end = s.indexOf('"', 1);
    return end === -1 ? s.slice(1) : s.slice(1, end);
  }
  const sp = s.search(/\s/);
  return sp === -1 ? s : s.slice(0, sp);
}

/**
 * 判定單一程序是否為 claude（強韌、零誤判面）：
 *  - name 結尾為 claude 可執行檔（含半可信改名 claude.exe，故須再綁 root 子樹過濾，見 matchClaude）。
 *  - 或 cmd 的 argv[0] 結尾為 claude 可執行檔（不認 'node claude-x.js' / 'C:\claude\app.exe' / 子字串 'fix claude'）。
 * null/缺欄一律當「不匹配」、永不丟例外（F-8-A2）。
 */
export function isClaudeProcess(p: ProcessInfo): boolean {
  const name = typeof p?.name === 'string' ? p.name : '';
  if (name !== '' && CLAUDE_EXE.test(name)) return true;
  const cmd = typeof p?.cmd === 'string' ? p.cmd : '';
  if (cmd === '') return false;
  const argv0 = firstToken(cmd);
  return argv0 !== '' && CLAUDE_EXE.test(argv0);
}

/**
 * 給某工作區的 root pids（shell 根 pid）＋全程序清單 → 找 root 子孫中的 claude，及其下是否仍有子程序。
 * 只認「rootPids 子樹」內的 claude（F-8-A3b：全機其他改名 claude.exe 不誤歸戶）。
 * 純函式、不丟例外、容忍 null 欄位（F-8-A2）。
 */
export function matchClaude(rootPids: readonly number[], processes: readonly ProcessInfo[]): ClaudeProbeResult {
  const byParent = new Map<number, number[]>();
  const byPid = new Map<number, ProcessInfo>();
  for (const p of processes) {
    if (!p || typeof p.pid !== 'number' || !Number.isFinite(p.pid)) continue;
    const ppid = typeof p.ppid === 'number' && Number.isFinite(p.ppid) ? p.ppid : 0;
    byPid.set(p.pid, p);
    const kids = byParent.get(ppid);
    if (kids) kids.push(p.pid);
    else byParent.set(ppid, [p.pid]);
  }

  // 收集 rootPids 的所有子孫（不含 root 本身＝shell；DFS + visited 防 pid 重用造成的環）。
  const descendants = new Set<number>();
  const stack: number[] = [];
  for (const r of rootPids) {
    if (typeof r !== 'number' || !Number.isFinite(r)) continue;
    const kids = byParent.get(r);
    if (kids) for (const k of kids) if (!descendants.has(k)) { descendants.add(k); stack.push(k); }
  }
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    const kids = byParent.get(pid);
    if (!kids) continue;
    for (const k of kids) if (!descendants.has(k)) { descendants.add(k); stack.push(k); }
  }

  const claudePids: number[] = [];
  for (const pid of descendants) {
    const info = byPid.get(pid);
    if (info && isClaudeProcess(info)) claudePids.push(pid);
  }

  let hasActiveChildren = false;
  for (const cp of claudePids) {
    const kids = byParent.get(cp);
    if (kids && kids.length > 0) {
      hasActiveChildren = true;
      break;
    }
  }

  return { claudePids, hasActiveChildren };
}
