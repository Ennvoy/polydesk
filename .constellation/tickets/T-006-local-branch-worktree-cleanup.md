# T-006 本機分支與 worktree 完整清理
status: done
blocked-by: T-005
zone: src/main/git/cleanup/local/**, src/main/git/cleanup/core/CleanupGitRunner.ts, src/main/git/cleanup/core/CleanupPreview.ts, src/main/git/cleanup/core/CleanupService.ts, src/main/store/cleanup/CleanupJournalStore.ts, src/shared/gitCleanup.ts, src/shared/types.ts, src/shared/channels.ts, src/shared/ipc.ts, src/main/workspace/**, src/main/git/GitService.ts, src/main/git/GitService.worktree.test.ts, src/renderer/components/Worktree/WorktreePanel.tsx, src/renderer/components/Worktree/worktreeRemoveModel*, src/renderer/components/SourceControl/SourceControlPanel.tsx, src/main/git/cleanup/local/**/*.test.ts, src/renderer/components/Worktree/*.test.ts

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

讓本機清理能在同一份已確認計畫中安全處理目前分支切換、所有占用 worktree、資料夾、local ref、reflog 與 branch config；任何競態或部分失敗都可補償、恢復或明確停在待處理狀態。

## 驗收條件（合成階段寫定，逐條可勾）
- [x] 一般已合併分支經 preview/execute 後，local ref、branch config、reflog 與 upstream metadata 均不存在；baseline、完整 retained-ref set 與 target OID 任一在確認後變動就停止並重算。
- [x] 尚未合併分支先做安全 ancestry 檢查；只有第二階段顯示完成後不可達的 commit 下限／確定數量並取得 danger 確認才可 CAS 刪除，shallow/partial/missing object 顯示 unknown 而不冒充確定數字。
- [x] 清理目前主工作樹分支時，使用者可選的切換候選只包含其他本地分支；工作樹不乾淨、候選被其他 worktree 使用或狀態變動時停止，不自動 stash、不刪主工作樹資料夾。
- [x] 分支被一或多個 linked worktree 使用時，preview 列出所有真實路徑、dirty/untracked/ignored/submodule、lock/prunable/managed 狀態；確認後依 strict teardown 與八態 reconcile 清資料夾、Git 登記及 Polydesk 工作區，不使用全域 prune。
- [x] prunable worktree 只允許另行確認後移除該筆 stale registration 且保留 branch；locked worktree 必須另行解除保護確認；確認後外部新寫入資料夾的殘餘風險在最終畫面明示。
- [x] target ref CAS 後若偵測到外部 worktree 新 checkout，會在未清 metadata 前以 expected-absent 恢復舊 OID並凍結計畫；第三方已重建同名 ref 時不覆寫。
- [x] Worktree 分頁提供「僅移出列表」「刪資料夾保留分支」「完整清理資料夾與本地分支」三個範圍，前兩者與完整清理共用 journal／reconciliation，不留未記錄的破壞性旁路。

## 決議記錄（實作期小事自決落此，可追溯）

- 真鏈路 Git/worktree/檔案系統行為以整合測試驗證；reflog/config/lease 的組合分支下推到真 Git 暫存 repository 測試，E2E 只留給 T-008 跨 UI 縫合。
- T-005 的 execute 只建立 prepared journal；為讓本票能在同一 journal 上接本機步驟，zone 補入既有 core/store/shared 接縫。這些檔案沒有與其他 in-progress 票重疊，T-007 仍待本票序列完成後才領票。
- retained-ref lease 補入 object type、symref 與 worktree scope；預計移除的 worktree 私有 refs 從「清理後仍保留」集合排除，執行前再由正確 worktree 路徑重列比對。這是避免錯 namespace 與風險低估所需的安全修正，因此同步擴充 core/shared zone。
- 移除舊全域 `git worktree prune` 的 renderer、IPC、service 與單測鏈，失效登記改為逐筆 journal 清理；detached worktree 只顯示保留分支的兩個範圍，仍共用 cleanup journal。
- 因 retained-ref 與舊 prune IPC 的影響面超出原縮圈，正式驗證補入 cleanup core 與 GitService worktree 測試；不是為洗綠縮窄，而是擴大到實際修改 seam。
- 第一次正式 runner 綠後逐條審核發現既有 lifecycle 仍吞 teardown 失敗，不能據此勾選嚴格 teardown 驗收；補入「全 concern 執行後彙總失敗」、delist-only 與八態純表／收斂邏輯，並將 workspace 測試加入第二次正式驗證。

## 驗證指令
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/local src/main/git/cleanup/core src/main/git/GitService.worktree.test.ts src/main/workspace src/renderer/components/Worktree`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-08-13T03:14:49.575Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/local src/main/git/cleanup/core src/main/git/GitService.worktree.test.ts src/renderer/components/Worktree`（exit 0）
    ```
       [33m[2m✓[22m[39m LocalCleanupExecutor checkout 競態補償[2m > [22mtarget CAS 後發現新 checkout，立即以 expected-absent 恢復 ref 並保留 metadata [33m 1080[2mms[22m[39m
     [32m✓[39m src/main/git/GitService.worktree.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 1087[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeDisplay.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 56[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeJump.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeModel.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeSubmit.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeConflict.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeRemoveModel.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m

    [2m Test Files [22m [1m[32m11 passed[39m[22m[90m (11)[39m
    [2m      Tests [22m [1m[32m67 passed[39m[22m[90m (67)[39m
    [2m   Start at [22m 10:58:50
    [2m   Duration [22m 958.60s[2m (transform 944ms, setup 0ms, collect 5.47s, tests 936.28s, environment 2ms, prepare 4.83s)[22m


    ```
  - 耗時：合計 968s｜cmd /c npm run typecheck -- --pretty false 6s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/local src/main/git/cleanup/core src/main/git/GitService.worktree.test.ts src/renderer/components/Worktree 962s
  - sig: 36971585e40c5b33c7467dc04427dd4aa8e21c820d3bbb17a25d5bad68d611fc
- **2026-08-13T03:25:40.387Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/local src/main/git/cleanup/core src/main/git/GitService.worktree.test.ts src/main/workspace src/renderer/components/Worktree`（exit 0）
    ```
     [32m✓[39m src/renderer/components/Worktree/worktreeDisplay.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 15[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeModel.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeSubmit.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeRemoveModel.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeJump.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeConflict.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/main/workspace/workspaceLifecycle.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/local/worktreeReconciliation.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 2[2mms[22m[39m

    [2m Test Files [22m [1m[32m15 passed[39m[22m[90m (15)[39m
    [2m      Tests [22m [1m[32m88 passed[39m[22m[90m (88)[39m
    [2m   Start at [22m 11:22:05
    [2m   Duration [22m 215.03s[2m (transform 456ms, setup 0ms, collect 1.76s, tests 208.20s, environment 2ms, prepare 1.80s)[22m


    ```
  - 耗時：合計 224s｜cmd /c npm run typecheck -- --pretty false 6s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/local src/main/git/cleanup/core src/main/git/GitService.worktree.test.ts src/main/workspace src/renderer/components/Worktree 218s
  - sig: 5895054610d2a1770d65ad36e6d90a686b7a0c4a28e38702e890259c6e94e5a8
