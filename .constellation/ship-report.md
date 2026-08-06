# SCM 分支分組與安全刪除出貨報告

## 做了什麼

- 分支頁將本地與遠端分支分組顯示，提供數量、獨立收合、共用 `⋯`／右鍵操作選單與具名停用原因。
- 本地刪除固定採安全 `git branch -d`；遠端刪除採精確 `git push <remote> --delete <branch>`，並以結構化 remote／branch 支援斜線 remote。
- 補齊結構化錯誤、控制字元中和、成功後完整刷新，以及真 Git、bare remote、worktree 與 Electron 回歸測試。
- 版本同步至 v0.21.0，更新 README、CHANGELOG、release notes、需求、設計與任務歷程；Claude／Codex 使用者專屬對話軸依決議 009 留待下一版。

## 驗了什麼

- 全量：TypeScript typecheck、正式 build、574 個 Vitest、110 個非豁免 Electron E2E 全綠。
- 審查後：Git／錯誤分類與版本同步 35/35 單測、關於視窗 1/1 Electron E2E、分支管理 1/1 Electron E2E 全綠。
- Spec 與 Standards 兩份乾淨上下文審查均無未解阻擋；合法 `team/backend` remote 的誤拆問題已修正並由原審查者複驗。
- `REQ-PERF-001` 冷啟動 `<3s` 在同機多 AI 負載下量得 p95 3159、3335、6437 ms；依使用者 2026-08-06 核准沿用既有豁免，門檻與測試未修改，ship 只排除該 1 案。

## 證據在哪

- 全量 runner 證據：`.constellation/archive/2026-08-06-scm-branch-management/ship-evidence.md`。
- 驗收票與逐項證據：`.constellation/archive/2026-08-06-scm-branch-management/tickets/T-001-scm-branch-management.md`。
- 需求與設計決議：`.constellation/decisions/001-branch-delete-scope.md` 至 `010-branch-management-design-final.md`。
- 功能回歸：`src/main/git/GitService.branchDelete.test.ts`、`src/main/git/gitErrorClassify.test.ts`、`e2e/git-branch-management.spec.ts`。
