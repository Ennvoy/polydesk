// push / gh 錯誤訊息分類（DF-12）。純 regex 模組（零 electron/Node 依賴）→ 可直接單測；
// 與 GitService.clone 內建分類器同哲學：把 stderr 原文分流成 UI 可給人話引導的 code。

import type { GitPublishErrorCode, GitPushErrorCode } from '../../shared/types';

/** 「分支沒 upstream」不是錯誤碼——push 會自動改跑 `push -u <remote> HEAD` 補救（VS Code 同款）。 */
export function isNoUpstreamError(message: string): boolean {
  return /has no upstream branch|no upstream configured|no tracking information/i.test(message);
}

export function classifyPushError(message: string, timedOut: boolean): GitPushErrorCode {
  if (timedOut) return 'timeout';
  // 完全沒設 remote：git 的兩種措辭（無 origin / push 目的地）
  if (/no configured push destination|'origin' does not appear to be a git repository/i.test(message)) return 'no-remote';
  // remote 有設但遠端 repo 不存在（GitHub 尚未建立/改名/無讀取權都回這句）
  if (/repository not found/i.test(message)) return 'remote-not-found';
  if (/authentication failed|permission denied|publickey|could not read username|access denied|HTTP 403/i.test(message)) return 'auth';
  if (/could not resolve host|failed to connect|connection (?:timed out|refused)|network is unreachable|unable to access/i.test(message)) return 'network';
  return 'failed';
}

export function classifyGhError(message: string, timedOut: boolean): GitPublishErrorCode {
  if (timedOut) return 'timeout';
  if (/already exists/i.test(message)) return 'name-exists';
  if (/not logged in|gh auth login|authentication|HTTP 401/i.test(message)) return 'gh-not-authed';
  if (/could not resolve host|failed to connect|connection (?:timed out|refused)|network is unreachable|unable to access|error connecting/i.test(message)) return 'network';
  return 'failed';
}
