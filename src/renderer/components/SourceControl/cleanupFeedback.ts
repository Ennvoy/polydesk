/**
 * 完整清理的行內回饋契約。
 * 同一張卡從進行中一路走到成功／失敗終態：破壞性操作的結果要留在畫面上等使用者確認，
 * 不能像一般提示那樣自己消失，也不能把 Git 原文直接糊在畫面上。
 * 卡片由 SCM 面板統一渲染，分支清理與 worktree 分頁的清理共用同一張。
 */
export type CleanupFeedback =
  | { kind: 'running'; branch: string; step: string }
  | { kind: 'done'; branch: string; did: string[] }
  | { kind: 'failed'; branch: string; message: string; detail?: string; journalId?: string };

/**
 * journal checkpoint → 使用者看得懂的一句話。
 * checkpoint 字串帶 worktree id、ref 或雜湊，一律不上畫面；未知的也只回通用敘述。
 */
export function cleanupCheckpointText(checkpoint: string): string {
  if (checkpoint.startsWith('worktree-removed:')) return '已移除 worktree 資料夾與登記';
  if (checkpoint.startsWith('worktree-delisted-after-reconcile:')) return '已在收斂階段移除 worktree 登記';
  if (checkpoint.startsWith('worktree-delisted:')) return '已移除 worktree 的 Git 登記';
  if (checkpoint.startsWith('worktree-stale-registration-removed:')) return '已移除失效的 worktree 登記';
  if (checkpoint.startsWith('worktree-registration-reconciled:')) return '已收斂 worktree 登記狀態';
  if (checkpoint.startsWith('worktree-unlocked:')) return '已解除 worktree 鎖定保護';
  if (checkpoint.startsWith('switched:')) return '已切換到指定分支';
  if (checkpoint === 'local-ref-deleted') return '已刪除本地分支 ref';
  if (checkpoint === 'local-ref-restored-after-worktree-race') return '偵測到新的 worktree 佔用，已還原本地分支';
  if (checkpoint === 'branch-config-cleared') return '已清除 branch 設定';
  if (checkpoint === 'branch-reflog-cleared') return '已清除 branch reflog';
  if (checkpoint.startsWith('remote:endpoint-deleted:')) return '已刪除一個遠端 endpoint 分支';
  if (checkpoint.startsWith('remote:tracking-deleted:')) return '已清除 remote-tracking ref';
  if (checkpoint.startsWith('remote:tracking-retained:')) return '有 remote-tracking ref 依安全規則保留';
  return '已完成一個清理步驟';
}

/** SCM 面板提供給分頁的回饋控制。 */
export interface CleanupFeedbackApi {
  /** 包住一次清理呼叫：期間輪詢 journal checkpoint 顯示進度。 */
  run: <T>(branch: string, operation: () => Promise<T>) => Promise<T>;
  /** 收成成功摘要，列出這次實際完成的步驟。 */
  done: (branch: string) => void;
  /** 收成失敗終態；有 journalId 時卡片提供「繼續收斂」。 */
  fail: (branch: string, message: string, journalId?: string) => void;
}
