# T-008 統一完整清理操作與說明
status: open
blocked-by: T-006, T-007
zone: src/main/git/GitService.ts, src/renderer/components/SourceControl/SourceControlPanel.tsx, src/renderer/components/SourceControl/BranchCleanupRiskDialog.tsx, src/renderer/components/Help/**, e2e/git-branch-management.spec.ts, e2e/worktree.spec.ts, specs/**

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

把定稿的兩階段清理 UI 接上真 preview/execute，統一本地分支列、遠端分支列與 worktree 分頁入口，讓使用者看得見計畫、風險、進度、部分結果與恢復待辦；同步完整指南與可重跑的真 Electron 回歸。

## 驗收條件（合成階段寫定，逐條可勾）
- [ ] 本地分支目前使用中或被 worktree 占用時，既有更多／右鍵選單不再停用刪除，而是開啟決議 078 定稿的第一階段；按「檢查清理風險」前真 Git/磁碟狀態零變更。
- [ ] 第二階段逐項顯示 switch、worktree 路徑與 dirty/locked/prunable、local ref/metadata、確定或 unknown commit 風險、每個 remote endpoint 與不可消除的外部寫入警告；普通安全刪除與需 force 的 danger 確認不重複或偷跳階段。
- [ ] 執行中 UI 防重入並逐步顯示狀態；完全成功後刷新 branch/snapshot/history/worktree/workspace，部分成功或 unknown 顯示已完成與可重試項目，不把失敗步驟回報成功。
- [ ] 遠端分支列單獨刪除也進同一 live discovery/OID lease/journal 管線；舊直接名稱式 push delete 與全域 worktree prune 破壞性旁路移除或 contract 為非破壞性相容入口。
- [ ] 啟動時存在 active/quarantine journal 會在 SCM 顯示 repository 級待辦；prepared 零副作用可取消，mutating/unknown 只能繼續 reconciliation 或匯入證據，人工封存不解鎖。
- [ ] 真 Electron E2E 覆蓋：已合併、未合併二階段、目前分支切換、linked worktree dirty／乾淨、三種 worktree 範圍、遠端 opt-in／tip 變動／部分失敗、重新啟動恢復，並直接查真 Git refs/config/reflog/路徑/remote 最終狀態。
- [ ] 完整使用指南同步入口、兩階段操作、錯誤/unknown/恢復與高風險提示；首次 7 步導覽因入口與主要資訊架構未變而不調升版本，E2E 證明原 selector/步驟仍有效。
- [ ] requirements、design、architecture、tasks 與專案地圖同步新 IPC、journal、清理狀態機與已知殘餘風險，不再描述「只能安全刪除、worktree 必須分開處理」。

## 決議記錄（實作期小事自決落此，可追溯）

- 風險摘要是定稿流程的第二狀態，沿用凍結畫面的 tokens、區塊層級與固定底部動作列，不解凍重畫第一階段。
- 新增 Electron E2E 是必要的跨程序縫合：renderer→preload→main→真 Git/worktree/remote/journal 無法由低層測試單獨證明；低層分支仍留在 T-005～T-007。

## 驗證指令（可選；票級縮圈清單，weave 寫定——省略則 runner 跑 config 全量）
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/renderer/components/SourceControl src/renderer/components/Worktree src/renderer/components/Help src/main/git/cleanup`
- `cmd /c npm run build`
- `cmd /c npm run e2e -- --workers=1 e2e/git-branch-management.spec.ts e2e/worktree.spec.ts`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
