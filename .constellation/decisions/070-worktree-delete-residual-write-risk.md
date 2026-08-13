# 070 worktree 資料夾刪除的外部寫入殘餘風險

## 背景

Polydesk 可以在 Git repository queue 內重驗 worktree digest，卻無法鎖住外部 editor、build process 或其他程式；最後重驗與遞迴刪除之間仍可能出現新檔案或內容變更。

## 決定

不把最後 digest 宣稱為原子保證，也不以 rename 隔離假裝能封住已開啟檔案描述符或 Windows handle。凡會刪除 worktree 資料夾的最終確認，都必須明示：「確認後到清理完成前，其他程式新建立或修改的內容也可能被永久刪除；請先停止在此資料夾工作的程式。」風險摘要列出最後一次掃描的 tracked/modified/untracked/ignored/submodule 狀態與掃描時間，執行前再重驗；重驗已變就回到確認，不開始刪除。重驗後才發生的外部寫入屬不可完全消除的殘餘風險，使用者接受上述明示後才可執行。

若作業系統或 Git 回報 sharing violation、busy、permission denied 或 identity 變動，停止並依決議 059 reconciliation，不用額外 force 繞過。Polydesk 不建立背景延遲刪除或重開機刪除任務。

## 原因

跨程序檔案系統沒有由 Polydesk 單方面取得的可靠全目錄寫入鎖；明確揭露、最後重驗與遇錯停止，比虛假的原子承諾可驗證。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 repository queue 只能序列化 Polydesk，自最後 digest 到 `worktree remove --force` 仍可能有外部寫入。
