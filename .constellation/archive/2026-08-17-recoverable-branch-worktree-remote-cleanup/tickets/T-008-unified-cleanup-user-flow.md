# T-008 統一完整清理操作與說明
status: done
blocked-by: T-006, T-007
zone: src/shared/gitCleanup.ts, src/shared/ipc.ts, src/main/git/GitService.ts, src/main/git/cleanup/core/**, src/main/git/cleanup/remote/**, src/main/store/cleanup/**, src/renderer/components/SourceControl/SourceControlPanel.tsx, src/renderer/components/SourceControl/BranchCleanupRiskDialog.tsx, src/renderer/components/Help/**, e2e/git-branch-management.spec.ts, e2e/worktree.spec.ts, specs/**

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

把定稿的兩階段清理 UI 接上真 preview/execute，統一本地分支列、遠端分支列與 worktree 分頁入口，讓使用者看得見計畫、風險、進度、部分結果與恢復待辦；同步完整指南與可重跑的真 Electron 回歸。

## 驗收條件（合成階段寫定，逐條可勾）
- [x] 本地分支目前使用中或被 worktree 占用時，既有更多／右鍵選單不再停用刪除，而是開啟決議 078 定稿的第一階段；按「檢查清理風險」前真 Git/磁碟狀態零變更。
- [x] 第二階段逐項顯示 switch、worktree 路徑與 dirty/locked/prunable、local ref/metadata、確定或 unknown commit 風險、每個 remote endpoint 與不可消除的外部寫入警告；普通安全刪除與需 force 的 danger 確認不重複或偷跳階段。
- [x] 執行中 UI 防重入並逐步顯示狀態；完全成功後刷新 branch/snapshot/history/worktree/workspace，部分成功或 unknown 顯示已完成與可重試項目，不把失敗步驟回報成功。
- [x] 遠端分支列單獨刪除也進同一 live discovery/OID lease/journal 管線；舊直接名稱式 push delete 與全域 worktree prune 破壞性旁路移除或 contract 為非破壞性相容入口。
- [x] 啟動時存在 active/quarantine journal 會在 SCM 顯示 repository 級待辦；prepared 零副作用可取消，mutating/unknown 只能繼續 reconciliation 或匯入證據，人工封存不解鎖。
- [x] 真 Electron E2E 覆蓋：已合併、未合併二階段、目前分支切換、linked worktree dirty／乾淨、三種 worktree 範圍、遠端 opt-in／tip 變動／部分失敗、重新啟動恢復，並直接查真 Git refs/config/reflog/路徑/remote 最終狀態。
- [x] 完整使用指南同步入口、兩階段操作、錯誤/unknown/恢復與高風險提示；首次 7 步導覽因入口與主要資訊架構未變而不調升版本，E2E 證明原 selector/步驟仍有效。
- [x] requirements、design、architecture、tasks 與專案地圖同步新 IPC、journal、清理狀態機與已知殘餘風險，不再描述「只能安全刪除、worktree 必須分開處理」。

## 決議記錄（實作期小事自決落此，可追溯）

- 風險摘要是定稿流程的第二狀態，沿用凍結畫面的 tokens、區塊層級與固定底部動作列，不解凍重畫第一階段。
- 新增 Electron E2E 是必要的跨程序縫合：renderer→preload→main→真 Git/worktree/remote/journal 無法由低層測試單獨證明；低層分支仍留在 T-005～T-007。
- 串接後才發現原 zone 漏列既有 shared cleanup 契約、core orchestration、remote adapter 與 journal payload/status；這些是把 T-005～T-007 接成同一 journal 的必要檔案，擴充 zone 但不新增另一條清理路徑。
- worktree 清理一律改以仍會存活的主工作樹作 repository 執行錨點，避免作用中 linked worktree 被刪後 Git 子程序失去 cwd。
- 多 endpoint 部分完成時，尚未滿足完整 producer 集合的 tracking ref 是可重試暫態，不寫永久保留 checkpoint；重啟收斂後才執行 CAS 清理。

## 驗證指令
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/renderer/components/SourceControl src/renderer/components/Worktree src/renderer/components/Help src/main/git/cleanup`
- `cmd /c npm run build`
- `cmd /c npm run e2e -- --workers=1 e2e/git-branch-management.spec.ts e2e/worktree.spec.ts`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-08-13T11:03:46.463Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/renderer/components/SourceControl src/renderer/components/Worktree src/renderer/components/Help src/main/git/cleanup`（exit 0）
    ```
     [32m✓[39m src/renderer/components/Worktree/worktreeSubmit.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/gitGraph.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeConflict.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeRemoveModel.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/remote/remoteIdentity.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeJump.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/local/worktreeReconciliation.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/fetchCooldown.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 2[2mms[22m[39m

    [2m Test Files [22m [1m[32m16 passed[39m[22m[90m (16)[39m
    [2m      Tests [22m [1m[32m89 passed[39m[22m[90m (89)[39m
    [2m   Start at [22m 18:58:25
    [2m   Duration [22m 150.44s[2m (transform 248ms, setup 0ms, collect 1.07s, tests 145.76s, environment 2ms, prepare 1.25s)[22m


    ```
  - `cmd /c npm run build`（exit 0）
    ```
    [2m../../out/renderer/[22m[36massets/redshift-CvYMMYZY.js                                    [39m[1m[2m    16.33 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/pgsql-DaSGFTLp.js                                       [39m[1m[2m    18.25 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/elixir-eLfY1jWH.js                                      [39m[1m[2m    18.74 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/postiats-CVVurEnu.js                                    [39m[1m[2m    19.30 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/powerquery-BQ_t1ZiQ.js                                  [39m[1m[2m    21.65 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/abap-D5KwWAsZ.js                                        [39m[1m[2m    22.97 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/solidity-yHOxYChb.js                                    [39m[1m[2m    26.03 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/jsonMode-CbqY6p3R.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-DYvplJdU.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-C8v1zsBw.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-9AWA9SQH.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-CgzbOdap.js                                       [39m[1m[33m 9,475.65 kB[39m[22m
    [32m✓ built in 33.26s[39m

    ```
  - `cmd /c npm run e2e -- --workers=1 e2e/git-branch-management.spec.ts e2e/worktree.spec.ts`（exit 0）
    ```


    Running 8 tests using 1 worker

      ok 1 e2e\git-branch-management.spec.ts:45:5 › 分支管理：本地／遠端分組與兩階段完整清理真鏈路 (28.4s)
      ok 2 e2e\git-branch-management.spec.ts:116:5 › 遠端多 endpoint 部分失敗後，重啟仍顯示待辦並可繼續收斂 (21.6s)
      ok 3 e2e\git-branch-management.spec.ts:169:5 › 遠端 tip 在風險確認後變動時拒絕舊租約且不刪新 commit (14.4s)
      ok 4 e2e\git-branch-management.spec.ts:195:5 › 刪除目前分支時先切換到使用者選定分支，再以同一流程清理 (12.5s)
      ok 5 e2e\worktree.spec.ts:30:5 › REQ-E2E-012：分支→建立 worktree→納管開啟→終端機 cwd＝worktree→切回主 repo (6.5s)
      ok 6 e2e\worktree.spec.ts:71:5 › REQ-E2E-013：移除 worktree——dirty 兩段確認→連同刪除；僅移出保留資料夾 (21.9s)
      ok 7 e2e\worktree.spec.ts:150:5 › worktree 移除相容舊資料：一般工作區加入時兩種移除都有效 (20.2s)
      ok 8 e2e\worktree.spec.ts:189:5 › F-13：分支分頁「在新 worktree 開啟」建立；checkout 衝突→跳到該 worktree (6.1s)

      8 passed (2.2m)

    ```
  - 耗時：合計 329s｜cmd /c npm run typecheck -- --pretty false 6s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/renderer/components/SourceControl src/renderer/components/Worktree src/renderer/components/Help src/main/git/cleanup 152s｜cmd /c npm run build 36s｜cmd /c npm run e2e -- --workers=1 e2e/git-branch-management.spec.ts e2e/worktree.spec.ts 134s
  - sig: 28e80d8cacfab2a6a5adc547c2eaef219bc3a16e47604dc2da907c95b9862476

## 出貨雙軸複核（2026-08-17）

- Standards：發現 endpoint 技術細節可能殘留到後續不相干錯誤的狀態污染；已讓每次設定一般錯誤時同步清空舊 detail，並通過 typecheck、build 與遠端多 endpoint 部分失敗真 Electron 回歸。修正後 0 blocker、0 suggestion。
- Spec：逐條核對 8 項驗收條件、程式內完整指南、兩階段操作、恢復卡響應式呈現與完整 ship runner；決議 080／083／084 的解凍均有使用者授權且已重新凍結，0 blocker、0 suggestion。
