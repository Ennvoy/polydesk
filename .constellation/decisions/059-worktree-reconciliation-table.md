# 059 worktree 三狀態 reconciliation 表

## 背景

worktree remove 回錯或當機後，實體 path、Git administrative 登記與 Polydesk workspace 登記各自可能存在或不存在，不能只依一個 error 字串假設現況。

## 決定

重試或啟動恢復必須先驗證 expected common-dir identity、expected path 與 lineage，再依 `path/Git/Polydesk`八態表執行唯一動作：

| path | Git | Polydesk | 動作 |
|---|---|---|---|
| 在 | 在 | 在 | 恢復 concerns；成功後可重試，失敗則凍結 |
| 在 | 在 | 不在 | 保留為未納管 worktree，不自動建 workspace；依 journal 繼續具名 remove |
| 在 | 不在 | 在 | 不刪資料夾；delist 並回報「Git 登記已消失、資料夾保留待人工檢查」 |
| 在 | 不在 | 不在 | 保留資料夾不自動刪，標人工檢查 |
| 不在 | 在 | 在 | 以雙 `--force` 具名 remove expected path 登記，成功後 delist |
| 不在 | 在 | 不在 | 以雙 `--force` 具名 remove expected path 登記 |
| 不在 | 不在 | 在 | delist，此 worktree 達成已移除 |
| 不在 | 不在 | 不在 | 此 worktree 達成已移除 |

任一 path 存在但 lineage 不符、部分路徑無法安全識別，或 Git 登記指向不同 identity，都在套表前優先 fail-closed 為人工檢查，絕不自動刪資料夾。

## 原因

八態表讓當機後的恢復可測試、互斥且可重試，並把「路徑還在但 Git 登記沒了」明確視為保留資料夾，不因原始意圖是刪除就猜測它安全可刪。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出決議 052 只有零散分流，尚未覆蓋 path、Git、Polydesk 全部八種組合。
