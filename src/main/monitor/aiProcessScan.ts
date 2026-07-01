// AI process 偵測：查目前真的在跑的 claude / codex process，回它們的 parent shell pid 集合。
//
// 用途：判斷「某 PTY（PtyManager.pidsOf 的 shell pid）底下是否真的在跑 claude/codex」，取代 hook/rollout 的殘留猜測——
// 只有 Polydesk 自己終端機真的有該 AI 子程序，才算該工作區在跑（VSCode/別處跑的、或早關掉的殘留都不算）。
//   - claude：獨立的 claude.exe，其 parent 就是跑它的 shell（powershell）＝node-pty 的 pty.pid。
//   - codex TUI：node 跑 codex.js，其 parent 也是 shell（powershell）。codex app-server 也是 node codex.js，
//     但它的 parent 是 sh/bash（非 Polydesk PTY），比對 pidsOf 時自然被排除，不會誤算。
//
// 效能：wmic 查詢 claude(name)~40ms、codex(cmdline like)~120ms（powershell 因啟動開銷 ~1s，故 wmic 為主、fallback）。
// fail-open：查詢失敗回空集合（呼叫端據此退回舊行為，不會誤把在跑的判成沒跑）。

import { execFile } from 'node:child_process';

export function parsePids(stdout: string): Set<number> {
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const n = Number.parseInt(line.trim(), 10);
    if (Number.isFinite(n) && n > 0) pids.add(n);
  }
  return pids;
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

/** powershell fallback（~1s，wmic 未來被移除時的後路）。失敗回空集合。 */
function viaPowershell(cimFilter: string): Promise<Set<number>> {
  return new Promise((resolve) => {
    const ps = `Get-CimInstance Win32_Process -Filter "${cimFilter}" -Property ParentProcessId | ForEach-Object { $_.ParentProcessId }`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => resolve(err ? new Set<number>() : parsePids(stdout)),
    );
  });
}

/** 目前所有 claude.exe 的 parent shell pid 集合（非 Windows 回空＝不 gate、退回舊行為）。 */
export async function scanClaudeShellPids(): Promise<Set<number>> {
  if (process.platform !== 'win32') return new Set();
  const w = await viaWmic("name='claude.exe'");
  return w ?? viaPowershell("Name='claude.exe'");
}

/** 目前所有 codex（node 跑 codex.js）的 parent shell pid 集合。app-server 也會被抓但其 parent 非 Polydesk PTY、比對時排除。 */
export async function scanCodexShellPids(): Promise<Set<number>> {
  if (process.platform !== 'win32') return new Set();
  const w = await viaWmic("name='node.exe' and commandline like '%codex.js%'");
  return w ?? viaPowershell("Name='node.exe' AND CommandLine LIKE '%codex.js%'");
}
