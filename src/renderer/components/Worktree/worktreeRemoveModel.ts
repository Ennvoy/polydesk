// worktree 移除決策純邏輯（F-12；REQ-WT-006/007）——與 React 解耦以單測（紅軍：dirty 繞過/半殘）。
// 兩段確認狀態機：連同刪除且有未提交變更 → 先 confirm-dirty（列變更數），使用者確定丟棄才帶 force。

export type RemovePlan =
  | { action: 'remove'; deleteFolder: boolean; force: boolean }
  | { action: 'confirm-dirty'; changedCount: number };

/**
 * 依「是否連同刪除資料夾」與「未提交變更數」決定下一步。
 * - 僅移出列表：直接 remove（不刪資料夾、不需 force）。
 * - 連同刪除 + 乾淨：remove(deleteFolder, force=false)。
 * - 連同刪除 + dirty：需兩段確認（回 confirm-dirty；使用者確定後另呼 confirmedDirtyRemoval 帶 force）。
 */
export function planRemoval(deleteFolder: boolean, changedCount: number): RemovePlan {
  if (!deleteFolder) return { action: 'remove', deleteFolder: false, force: false };
  if (changedCount > 0) return { action: 'confirm-dirty', changedCount };
  return { action: 'remove', deleteFolder: true, force: false };
}

/** 使用者於 dirty 兩段確認勾「確定丟棄」後：連同刪除 + force（回傳收窄的 remove 變體，供直接讀 .force）。 */
export function confirmedDirtyRemoval(): { action: 'remove'; deleteFolder: boolean; force: boolean } {
  return { action: 'remove', deleteFolder: true, force: true };
}
