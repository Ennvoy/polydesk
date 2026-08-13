# 075 外部 worktree checkout 與 branch ref CAS 的競態恢復

## 背景

低階 `update-ref` 不具有 porcelain branch delete 對已 checkout worktree 的完整防護；外部 Git 可在最後一次 worktree list 後把仍保留的 worktree checkout 到目標分支。

## 決定

確認與 journal 必須保存所有 worktree 的 identity、HEAD symref target、HEAD OID 與路徑 digest。刪 target ref 前最後重驗全部 worktree HEAD；若 refs backend/Git 版本能在同一 reference transaction 內 verify 相關 HEAD，就與 target CAS 一起驗證。無法原子驗證時，target CAS 後立即重新列舉 worktree HEAD，且在這個檢查完成前不得 drop target reflog、清 branch config、移除任何新 worktree 或執行遠端步驟。

若發現確認後新增或改成 checkout target 的 worktree，立刻用 journal old OID 與 cleanup generation 以 expected-absent CAS 恢復 target ref，保留 reflog/config，將 journal 凍結為「外部 checkout 競態」並要求重新確認；ref 已被第三方重建或無法安全恢復時不得覆寫，轉人工 reconciliation。恢復成功也不回報清理成功，必須重新 discovery。這是補償式 transaction，不宣稱刪除瞬間完全原子。

## 原因

最終重驗縮小競態窗，刪後即時偵測與 expected-absent 恢復則避免留下 worktree HEAD 指向已刪 branch，並保護第三方同名重建。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 `update-ref` 可在外部 worktree 新 checkout 後刪掉其 branch ref。
