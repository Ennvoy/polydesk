## 2026-08-06 Claude／Codex 使用者提問對話軸
- 完成 1 張票：Claude／Codex 對話軸只保留使用者提問，快捷與手動啟動行為一致。
- 影響 terminal renderer、shared IPC、PTY／process／session 綁定、Claude transcript 與 Codex rollout reader。
- 關鍵決策：`decisions/006`–`009`、`011`；無可靠 terminal/session 證據時一律 fail-closed。
- 全量 591 Vitest、109 非豁免 E2E 綠；3 個真 AI dogfood 跳過，冷啟動既有門檻依核准豁免。

## 2026-08-06 SCM 分支分組與安全刪除
- 完成 1 張票：本地／遠端分組、共用操作選單與安全刪除完整鏈路。
- 影響 SCM renderer、shared IPC／型別、GitService、錯誤分類與真 Git／Electron 測試。
- 關鍵決策：`decisions/001`–`005`、`009`–`010`；對話軸功能延後獨立發布。
- 全量 574 Vitest、110 非豁免 E2E 綠；冷啟動既有門檻依使用者核准豁免。
