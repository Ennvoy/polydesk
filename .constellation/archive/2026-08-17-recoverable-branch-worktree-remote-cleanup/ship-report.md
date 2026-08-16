# v0.30.0 出貨報告

## 做了什麼

- T-005：建立零副作用 preview、repository lease、write-ahead journal、claim 重建與 quarantine 證據匯入。
- T-006：以 CAS 與完整 worktree 狀態收斂本機分支、資料夾、metadata 及 workspace 資源。
- T-007：逐 effective push endpoint 以 expected OID 租約清理遠端分支，支援部分失敗續跑。
- T-008：串接兩階段完整清理 UI、重啟待辦、風險提示、完整指南與窄側欄響應式呈現。
- T-009：把四個側欄入口移到受控內容頂部，並將版面顯隱控制改為低彩度底線狀態。

## 驗了什麼

- 完整 ship runner 20/20 指令通過：typecheck、build、77 個 Vitest 檔 626/626、12 個單 worker Electron E2E shard 共 115 通過；3 個真 AI dogfood 依條件跳過，既有 `REQ-PERF-001` 豁免維持分離。
- Standards 軸：以 `652ebe4...HEAD` 與工作樹差異檢查 repo 規範、12 類 smell、IPC／Git 安全邊界及真鏈路效率；發現 1 個 stale detail 狀態污染，修正與複驗後 0 blocker、0 suggestion。
- Spec 軸：逐條核對五票共 34 項驗收條件，以及本輪 design freeze／unfreeze 授權；決議 080、083、084 皆可追溯且重新凍結，0 blocker、0 suggestion。高風險標記為「無」，未觸發 security 第三軸。

## 證據在哪

- 全量 runner 指令、輸出、耗時與簽章：本歸檔目錄的 `ship-evidence.md`。
- 逐票正式驗證與 Standards／Spec 結論：本歸檔目錄 `tickets/T-005` 至 `T-009` 對應票檔。
- 視覺核准與解凍脈絡：本歸檔目錄 `design-frozen.json`，以及仍留在主目錄的 `.constellation/decisions/080`、`083`、`084`。
