# 迭代歷史

本文件記錄 Polydesk 對使用者可見的功能與修正。內部工作拆解與驗證細節請參閱 [`specs/tasks.md`](specs/tasks.md)。

## 2026-07-14

### 新增

- 工作區新增流程支援透過 HTTPS 或 SSH Clone Git Repository，完成後自動納管並開啟工作區。

### 改善

- SCM 面板開啟期間會低頻檢查 `HEAD`、目前分支及 ahead / behind；在整合終端機或外部 Git 工具完成 commit / push 後可自動同步狀態。
- 視窗重新取得焦點或頁面恢復可見時會立即補查 Git 狀態，避免等待下一次輪詢。
- 歷史頁的遠端分支改用固定寬度雲端圖示，避免壓縮 commit 主旨；滑鼠停留與輔助技術仍可取得完整名稱。

### 修正

- 修正 `.git` 目錄未納入檔案監聽時，SCM「未推送」數量在外部 push 後仍顯示舊值的問題。

### 驗證

- 通過 TypeScript 型別檢查、正式建置、GitService 單元測試，以及外部 push 自動刷新與遠端分支徽章端對端測試。
- 完整 Vitest 平行執行時有 3 個測試檔受 Windows 資源競爭影響；改用單 worker 重跑後共 11 個案例全部通過。
