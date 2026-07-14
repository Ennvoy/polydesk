// AI process 偵測：查目前真的在跑的 claude / codex / agy process，回它們的 parent shell pid 集合。
//
// 用途：判斷「某 PTY（PtyManager.pidsOf 的 shell pid）底下是否真的在跑 claude/codex/agy」，取代 hook/rollout 的殘留猜測——
// 只有 Polydesk 自己終端機真的有該 AI 子程序，才算該工作區在跑（VSCode/別處跑的、或早關掉的殘留都不算）。
//   - claude：獨立的 claude.exe，其 parent 就是跑它的 shell（powershell）＝node-pty 的 pty.pid。
//   - codex TUI：node 跑 codex.js，其 parent 也是 shell（powershell）。codex app-server 也是 node codex.js，
//     但它的 parent 是 sh/bash（非 Polydesk PTY），比對 pidsOf 時自然被排除，不會誤算。
//
// 效能：wmic 查詢 claude(name)~40ms、codex(cmdline like)~120ms；但 Win11 24H2+ 預設已移除 wmic，
// 屆時走 powershell fallback——單一 spawn＋單次 Win32_Process 列舉同時餵兩個工具（忙碌機器上此列舉
// 可達 5s+，合併查詢把 WMI 負載砍半），timeout 放寬到 15s。
// fail-open：查詢失敗/逾時該工具回 null（呼叫端保留上次成功的快取，不把在跑的誤判成沒跑）。
// 非 Windows 回空集合（平台不支援此偵測）。

import { execFile } from 'node:child_process';

/** 各工具的 parent shell pid 集合；null＝該工具本輪掃描失敗（呼叫端保留舊快取）。 */
export interface AiShellPids {
  claude: Set<number> | null;
  codex: Set<number> | null;
  agy: Set<number> | null;
}

export function parsePids(stdout: string): Set<number> {
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const n = Number.parseInt(line.trim(), 10);
    if (Number.isFinite(n) && n > 0) pids.add(n);
  }
  return pids;
}

/** 解析合併掃描輸出（每行 `C:<pid>`、`X:<pid>` 或 `A:<pid>`）→ 各工具 pid 集合。 */
export function parseTaggedPids(stdout: string): { claude: Set<number>; codex: Set<number>; agy: Set<number> } {
  const claude = new Set<number>();
  const codex = new Set<number>();
  const agy = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    const n = Number.parseInt(t.slice(2), 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (t.startsWith('C:')) claude.add(n);
    else if (t.startsWith('X:')) codex.add(n);
    else if (t.startsWith('A:')) agy.add(n);
  }
  return { claude, codex, agy };
}

/** wmic 查符合 where 的 process 的 ParentProcessId 集合；wmic 不存在/失敗回 null 交 fallback。 */
function viaWmic(where: string): Promise<Set<number> | null> {
  return new Promise((resolve) => {
    execFile(
      'wmic',
      ['process', 'where', where, 'get', 'ParentProcessId'],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => resolve(err ? null : parsePids(stdout)),
    );
  });
}

/**
 * powershell fallback（wmic 被移除的機器）：單一 spawn＋單次 Win32_Process 列舉，本地過濾同時得出
 * claude、codex 與 agy 的 parent pid（輸出 `C:<pid>` / `X:<pid>` / `A:<pid>`）。失敗/逾時回 null（fail-open）。
 */
function viaPowershellAll(): Promise<{ claude: Set<number>; codex: Set<number>; agy: Set<number> } | null> {
  return new Promise((resolve) => {
    const ps = [
      "$all = Get-CimInstance Win32_Process -Property Name,ParentProcessId,CommandLine;",
      'foreach ($p in $all) {',
      "  if ($p.Name -eq 'claude.exe') { 'C:' + $p.ParentProcessId }",
      "  elseif ($p.Name -eq 'node.exe' -and $p.CommandLine -like '*codex.js*') { 'X:' + $p.ParentProcessId }",
      "  elseif ($p.Name -eq 'agy.exe') { 'A:' + $p.ParentProcessId }",
      '}',
    ].join(' ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => resolve(err ? null : parseTaggedPids(stdout)),
    );
  });
}

/**
 * 一趟掃出 claude + codex + agy 的 parent shell pid 集合：wmic 都成功即用（快路徑）；
 * 否則單一 powershell 合併查詢；再失敗回個別 wmic 成功的部分、失敗的工具為 null。
 */
export async function scanAiShellPids(): Promise<AiShellPids> {
  if (process.platform !== 'win32') return { claude: new Set(), codex: new Set(), agy: new Set() };
  const [wc, wx, wa] = await Promise.all([
    viaWmic("name='claude.exe'"),
    viaWmic("name='node.exe' and commandline like '%codex.js%'"),
    viaWmic("name='agy.exe'"),
  ]);
  if (wc && wx && wa) return { claude: wc, codex: wx, agy: wa };
  const all = await viaPowershellAll();
  return all ?? { claude: wc, codex: wx, agy: wa };
}
