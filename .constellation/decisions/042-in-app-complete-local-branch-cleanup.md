# 042 Polydesk 內完整清理本地分支

## 背景

現行 Polydesk 移除 worktree 只會移除 Git 登記與資料夾，本地分支若尚未合併則會被安全刪除機制保留，使用者必須離開 Polydesk 才能完成清理。

## 決定

Polydesk 必須提供可從應用程式內完整刪除本地分支的路徑，不得再把含未合併 commit 的分支一律留給使用者到終端機手動處理；強制刪除的確認強度與 worktree 連動細節待本輪訪談定案。

## 原因

使用者期待在 Polydesk 內刪除分支就能把本地殘留清理完整，不應該再依賴額外的 Git CLI 指令。

## 證據

使用者原話：「我希望從polydesk刪除分支就可以完全清乾淨」。當時實測 `crm-system` 的 `profile` worktree 與資料夾已不存在，但本地分支仍指向 `2823fb1` 且含 6 個 Git 判定尚未合併至 `main` 的 commit。
