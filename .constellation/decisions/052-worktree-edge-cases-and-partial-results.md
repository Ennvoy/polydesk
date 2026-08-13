# 052 worktree 邊界、嚴格 teardown 與部分結果

## 背景

worktree 可能未被 Polydesk 納管、已失效、被 Git lock、處於 detached HEAD，或含 dirty、untracked、ignored 與 submodule 資料；現行 teardown 會吞掉 concern 失敗，也沒有完整的斷點結果。

## 決定

未納管 worktree 可在 main 端完成 lineage 驗證並顯示真實路徑後納入完整清理，不必先永久加入 Polydesk。prunable 只代表路徑當下不可達，無法完成資料夾 digest 與在途 Git 操作驗證，因此不得繼續完整清理或刪除分支；風險摘要只提供獨立的「只清除這筆 Git 失效登記」選項，明示未驗證資料夾、不刪本地分支，並以具名 `git worktree remove --force --force -- <expected-path>` 作為 target-scoped primitive，不使用會掃全 repo 的 `worktree prune`。detached worktree 只刪資料夾，明示「沒有本地分支可刪」。locked worktree 必須在風險摘要顯示 lock reason，並另行勾選「解除 Git 保護並強制清理」才能使用雙 `--force`。

已納管 worktree 的不可逆清理使用嚴格 teardown：所有已註冊 concern 都執行，任一失敗即保留工作區與 Git 登記並停止刪除。嚴格 teardown 後若 Git worktree remove 回錯、逾時或程序中止，不假設原工作區仍完整；依決議 059 的八態 reconcile 表重查實體路徑、Git worktree 登記與 Polydesk 納管登記，只執行該表允許的恢復、delist、target-scoped 補移除或人工處理，不再使用全域 prune。

摘要除 dirty 數量外，必須明文警告整個資料夾中的 untracked、ignored 與 submodule 內容也會被刪除。執行回傳每一步的結構化成功／失敗／未知結果；本地分支已刪而 live-only 遠端仍失敗時，將未完成 endpoint fingerprint、已遮罩顯示名、branch、expected OID 與最後結果持久化到 Polydesk userData，不儲存可能含密碼或 token 的原始 URL。重試時以 fingerprint 從當下 Git config 重新解析 endpoint，找不到或組態已變就要求重新 discovery 與確認。SCM 顯示可重試項目，直到成功或使用者明確放棄；不把未完成目標假設成一定存在於 remote-tracking 列表。

## 原因

這些邊界不能用單一「被 worktree 使用」狀態帶過。明確授權、嚴格釋放 handle、全資料夾警告與可重試結果，才能在不偽裝原子成功的前提下安全做到一站式清理。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查根據現行 worktree parser、boolean force、未納管阻擋、fail-open lifecycle 與 Git worktree 強制移除規則，指出上述狀態尚未被既有決議定義。
