# 066 mutating journal 的零副作用恢復

## 背景

write-ahead 必須在真正變更前先落盤 `mutating`，因此程序可能在 phase 已更新、第一個不可逆步驟尚未發生的極小窗口當機。

## 決定

啟動 reconciliation 不只相信 journal phase。`mutating` journal 若能證明所有 branch/baseline refs、config/reflog D0、worktree path/Git/Polydesk identities、dirty digests、local tracking refs 與遠端 expected state 全部完全等於 prepared pre-state，且沒有任何 cleanup-generation 記錄，就將 journal 原子降回 `prepared/no-side-effect`，允許取消。任一資源無法證明、狀態已變或存在 generation 蹤跡，都維持 mutating 並依 journal 繼續，不以「看起來沒刪」猜測零副作用。

## 原因

以全資源 pre-state 證明降級，既不會讓當機時間點把零副作用計畫永久鎖死，也不會只看一個 phase 或一條 ref 就過早丟棄恢復證據。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 `mutating` 必須先落盤的必然窗口會產生「phase 已變、實體尚零副作用」的可恢復狀態。
