# 061 在途 Git 操作 marker 能力表

## 背景

「其他 Git 已知在途操作」若不列出可測試集合，實作可能各自遺漏不同狀態。

## 決定

本版必備 marker 表為：`MERGE_HEAD`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`、`REBASE_HEAD`、`BISECT_START`、`rebase-merge`、`rebase-apply`、`sequencer`、`AM_HEAD`、`AUTO_MERGE`；位置一律由目標 worktree 的 `git rev-parse --git-path <marker>` 解出，不手猜 `.git` 目錄結構。Git 版本能力偵測若發現額外可明確識別的在途狀態，可以擴充 marker 表；無法解出 git-dir、marker 檢查遇到權限／I/O 錯誤，或偵測能力未知時一律回結構化 `operation-state-unknown` 並 fail-closed，不當成「沒有在途操作」。

## 原因

具體 marker 表與 Git 自行解路徑讓測試能逐一造出狀態，並使新 Git 版本的擴充不必破壞現有契約。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出決議 058 的「其他已知 marker」不是可驗收定義。
