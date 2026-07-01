// AI process 偵測：查目前真的在跑的 claude 的 parent shell pid 集合。
//
// 用途：判斷「某 PTY（PtyManager.pidsOf 的 shell pid）底下是否真的在跑 claude」，取代 hook 狀態檔的殘留猜測——
// 只有 Polydesk 自己終端機真的有 claude 子程序，才算該工作區 claude 在跑（在 VSCode/別處跑的、或早已關掉的殘留都不算）。
// claude 在 Windows 是獨立的 claude.exe，其 parent 就是跑它的 shell（powershell）＝node-pty 的 pty.pid，可直接比對。
//
// 效能：wmic 新啟查詢 ~40ms（powershell 因啟動開銷 ~1s，故 wmic 為主）；wmic 不在時 fallback powershell。
// fail-open：查詢失敗回空集合（呼叫端據此退回舊行為，不會誤把在跑的 claude 判成沒跑）。

import { execFile } from 'node:child_process';

export function parsePids(stdout: string): Set<number> {
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const n = Number.parseInt(line.trim(), 10);
    if (Number.isFinite(n) && n > 0) pids.add(n);
  }
  return pids;
}

/** wmic 查 claude.exe 的 ParentProcessId（~40ms）；wmic 不存在/失敗回 null 交 fallback。 */
function viaWmic(): Promise<Set<number> | null> {
  return new Promise((resolve) => {
    execFile(
      'wmic',
      ['process', 'where', "name='claude.exe'", 'get', 'ParentProcessId'],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => resolve(err ? null : parsePids(stdout)),
    );
  });
}

/** powershell fallback（~1s，wmic 未來被移除時的後路）。失敗回空集合。 */
function viaPowershell(): Promise<Set<number>> {
  return new Promise((resolve) => {
    const ps =
      'Get-CimInstance Win32_Process -Filter "Name=\'claude.exe\'" -Property ParentProcessId | ForEach-Object { $_.ParentProcessId }';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => resolve(err ? new Set<number>() : parsePids(stdout)),
    );
  });
}

/** 查目前所有 claude.exe 的 parent shell pid 集合（非 Windows 回空＝不 gate、退回舊行為）。 */
export async function scanClaudeShellPids(): Promise<Set<number>> {
  if (process.platform !== 'win32') return new Set();
  const w = await viaWmic();
  if (w) return w;
  return viaPowershell();
}
