# 056 本地分支 ref、設定與 reflog 完整清理

## 背景

使用 expected-old-OID 的低階 `update-ref` 可防止外部 Git 在確認後偷換 branch tip，但只刪 ref 不一定等價於 porcelain `git branch -d/-D` 的 branch config 與 reflog 清理。

## 決定

本地分支刪除的完成條件同時包含：`refs/heads/<name>` 已以 expected-old-OID CAS 刪除、`branch.<name>.*` 設定區段已以名稱安全的非 shell Git config 操作清除，且該分支 reflog 已無法列舉。reflog 清理能力一律以較新決議 063 為準：必須支援 `reflog drop <full-ref>`，不支援時一般安全分支刪除與強制完整清理都禁用，不使用手動 log 檔或逐項 entry fallback。順序固定為 ref CAS → reflog drop → config 清理 → reflog 與 config 完成驗證。journal 必須保存確認時的 branch config canonical snapshot／reflog digest、upstream remote／merge 身分與 cleanup generation；任一 metadata 動作前，若同名 ref 已重建、config／reflog 與 expected-state 不符或 upstream 身分變動，立即 fail-closed 並要求人工檢查。ref 刪除後 metadata 失敗必須回傳「ref 已刪、metadata 待清」，不得回報完整成功。

## 原因

「完全清乾淨」不只是讓分支從列表消失；同名 branch 的 upstream、description、merge 設定與 reflog 也不應殘留。將可重試的 metadata 階段單獨回報，可以兼顧 CAS 安全與完整語意。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 `git branch -d/-D` 會處理 branch config 與 reflog，而決議 051 改用 `update-ref` CAS 後尚未定義這些 metadata 的完整清理與部分失敗。
