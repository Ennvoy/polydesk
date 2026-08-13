# T-006 本機分支與 worktree 完整清理
status: open
blocked-by: T-005
zone: src/main/git/cleanup/local/**, src/main/workspace/**, src/renderer/components/Worktree/WorktreePanel.tsx, src/renderer/components/Worktree/worktreeRemoveModel*, src/main/git/cleanup/local/**/*.test.ts, src/renderer/components/Worktree/*.test.ts

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

讓本機清理能在同一份已確認計畫中安全處理目前分支切換、所有占用 worktree、資料夾、local ref、reflog 與 branch config；任何競態或部分失敗都可補償、恢復或明確停在待處理狀態。

## 驗收條件（合成階段寫定，逐條可勾）
- [ ] 一般已合併分支經 preview/execute 後，local ref、branch config、reflog 與 upstream metadata 均不存在；baseline、完整 retained-ref set 與 target OID 任一在確認後變動就停止並重算。
- [ ] 尚未合併分支先做安全 ancestry 檢查；只有第二階段顯示完成後不可達的 commit 下限／確定數量並取得 danger 確認才可 CAS 刪除，shallow/partial/missing object 顯示 unknown 而不冒充確定數字。
- [ ] 清理目前主工作樹分支時，使用者可選的切換候選只包含其他本地分支；工作樹不乾淨、候選被其他 worktree 使用或狀態變動時停止，不自動 stash、不刪主工作樹資料夾。
- [ ] 分支被一或多個 linked worktree 使用時，preview 列出所有真實路徑、dirty/untracked/ignored/submodule、lock/prunable/managed 狀態；確認後依 strict teardown 與八態 reconcile 清資料夾、Git 登記及 Polydesk 工作區，不使用全域 prune。
- [ ] prunable worktree 只允許另行確認後移除該筆 stale registration 且保留 branch；locked worktree 必須另行解除保護確認；確認後外部新寫入資料夾的殘餘風險在最終畫面明示。
- [ ] target ref CAS 後若偵測到外部 worktree 新 checkout，會在未清 metadata 前以 expected-absent 恢復舊 OID並凍結計畫；第三方已重建同名 ref 時不覆寫。
- [ ] Worktree 分頁提供「僅移出列表」「刪資料夾保留分支」「完整清理資料夾與本地分支」三個範圍，前兩者與完整清理共用 journal／reconciliation，不留未記錄的破壞性旁路。

## 決議記錄（實作期小事自決落此，可追溯）

- 真鏈路 Git/worktree/檔案系統行為以整合測試驗證；reflog/config/lease 的組合分支下推到真 Git 暫存 repository 測試，E2E 只留給 T-008 跨 UI 縫合。

## 驗證指令（可選；票級縮圈清單，weave 寫定——省略則 runner 跑 config 全量）
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/local src/renderer/components/Worktree`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
