# T-007 租約式遠端分支清理
status: done
blocked-by: T-005
zone: src/main/git/cleanup/remote/**, src/main/git/cleanup/remote/**/*.test.ts

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

讓所有伺服器分支刪除共用 live effective push endpoint discovery、expected OID compare-and-delete、tracking ref producer 分析與可恢復 receipt；不可見、離線、變更或多 endpoint 部分成功都不會被偽裝成完成。

## 驗收條件（合成階段寫定，逐條可勾）
- [x] 只有使用者 opt-in 才連線；每個 remote 以 Git 的 effective push URL precedence 解析，pushurl 取代 url 並套用 rewrite，多 endpoint 個別遮罩顯示、確認、執行與回報，journal 不存 raw URL／credential。
- [x] 遠端候選包含同名 branch 與實際 upstream 不同名 branch，實際 upstream 預選、其餘逐項未選；狀態未知不可選，使用者可取消遠端部分繼續本機清理。
- [x] 每個 endpoint 動手前在 repository queue 內重驗 live tip、local branch/upstream、journal/receipt claims、refspec producer digest；任一 lease 變動或 server stale 回應都停在重新確認，不刪新 commit。
- [x] hidden/permission/ambiguous 的讀取結果保持 unknown；只有 receive-pack delete 語意可證明成功或 absent，不能用一般 upload-pack 查無清除 receipt。
- [x] remote-tracking ref 依完整 fetch refspec producer set 判斷，只自動清 `refs/remotes/*`；重疊、負 refspec、非 tracking namespace、未選 producer 或 unresolved mapping 均保留並納入可達性。
- [x] tracking reflog、典型 remote HEAD symref、cleanup generation 與 expected-state 一致時才清；其他 symref、metadata 或 config 競態 fail-closed。
- [x] 多 endpoint 部分成功與程序中止會逐步 checkpoint；離線重啟不阻塞 UI，成功項不重做、unknown 可重試、remote-only receipt 只有永久保留本機 refs 後才可與新本機計畫並存。
- [x] shallow/partial/missing object graph 未能補齊完整遠端可達性時，伺服器刪除停用，本機清理仍可獨立完成。

## 決議記錄（實作期小事自決落此，可追溯）

- 多 endpoint、pushurl/rewrite、hidden/ambiguous 回應使用本機 bare remote 與受控 receive-pack helper 做真 Git 整合測試；不以 mock Git 取代協定行為。
- 遠端引擎以注入的 claim guard 與結構化 checkpoint adapter 對接 store；T-008 只負責把既有 journal/claim 實例接進來，不另開遠端刪除旁路。
- 程序重啟只從 journal 保存的去密 plan 恢復，再以當下 `git remote get-url --push --all` 唯一對回 raw endpoint；恢復本身不連線，重試才連線。
- tracking ref 與典型 `<remote>/HEAD` 使用同一個 expected-state `update-ref --stdin` transaction；非典型 symref、refspec 歧義與 metadata 競態保留 journal，不猜測刪除。
- 驗證清單內容未調整；只把 weave 模板的帶註解標題改成 runner 要求的精確 `## 驗證指令`，避免誤跑全量並撞到不屬於本票的 SearchService Windows EPERM 清理 flake。

## 驗證指令
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/remote`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-08-13T03:53:24.286Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6`（exit 0）
    ```
     [32m✓[39m src/main/git/cleanup/local/LocalCleanupExecutor.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 319[2mms[22m[39m
       [33m[2m✓[22m[39m LocalCleanupExecutor checkout 競態補償[2m > [22mtarget CAS 後發現新 checkout，立即以 expected-absent 恢復 ref 並保留 metadata [33m 318[2mms[22m[39m
     [32m✓[39m src/main/git/worktreePath.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 14[2mms[22m[39m
     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 7[2mms[22m[39m
     [32m✓[39m tests/security/rendererBaseline.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/gitGraph.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/ptyDataDispatcher.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 7[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeRemoveModel.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m

    [2m Test Files [22m [1m[32m13 passed[39m[22m[90m (13)[39m
    [2m      Tests [22m [1m[32m69 passed[39m[22m[90m (69)[39m
    [2m   Start at [22m 11:47:45
    [2m   Duration [22m 196.23s[2m (transform 593ms, setup 0ms, collect 2.96s, tests 187.47s, environment 2ms, prepare 1.95s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6`（exit 0）
    ```
     [32m✓[39m src/renderer/components/Terminal/terminalFileLinks.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/monitor/claudeHookState.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalWebLinks.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/store/schema.terminalFont.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m tests/security/spawnEnv.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/fetchCooldown.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m tests/security/conversationAccess.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/remote/remoteIdentity.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 2[2mms[22m[39m

    [2m Test Files [22m [1m[32m13 passed[39m[22m[90m (13)[39m
    [2m      Tests [22m [1m[32m90 passed[39m[22m[90m (90)[39m
    [2m   Start at [22m 11:51:03
    [2m   Duration [22m 61.36s[2m (transform 457ms, setup 0ms, collect 2.30s, tests 55.41s, environment 2ms, prepare 1.22s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6`（exit 0）
    ```
     [32m✓[39m src/renderer/state/editorBus.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/lsp/languageRegistry.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/monitor/aiProcessScan.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeSubmit.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/displayNormalize.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/secureOptions.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/store/schema.onboarding.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/local/worktreeReconciliation.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 2[2mms[22m[39m

    [2m Test Files [22m [1m[32m13 passed[39m[22m[90m (13)[39m
    [2m      Tests [22m [1m[32m114 passed[39m[22m[90m (114)[39m
    [2m   Start at [22m 11:52:06
    [2m   Duration [22m 22.20s[2m (transform 438ms, setup 0ms, collect 1.63s, tests 17.50s, environment 2ms, prepare 1.01s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6`（exit 0）
    ```
     [32m✓[39m src/main/claude/statuslineUsage.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 93[2mms[22m[39m
     [32m✓[39m src/main/lsp/LspManager.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 136[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeDisplay.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 11[2mms[22m[39m
     [32m✓[39m tests/security/worktreeTrust.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/remote/refspecMapping.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 11[2mms[22m[39m
     [32m✓[39m src/main/monitor/ClaudeStatusMonitor.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 8[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/clipboardKeys.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/shared/externalUrl.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 2[2mms[22m[39m

    [2m Test Files [22m [1m[32m13 passed[39m[22m[90m (13)[39m
    [2m      Tests [22m [1m[32m116 passed[39m[22m[90m (116)[39m
    [2m   Start at [22m 11:52:30
    [2m   Duration [22m 32.20s[2m (transform 542ms, setup 0ms, collect 2.29s, tests 26.69s, environment 2ms, prepare 1.02s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6`（exit 0）
    ```
     [32m✓[39m src/main/monitor/agyLog.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 35[2mms[22m[39m
     [32m✓[39m src/renderer/state/gitSnapshot.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/pathDrop.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/store/schema.worktree.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/git/gitSafeArgs.test.ts [2m([22m[2m42 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/main/git/gitErrorClassify.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeModel.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Dialogs/TrustConfirm.tsx.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 3[2mms[22m[39m

    [2m Test Files [22m [1m[32m13 passed[39m[22m[90m (13)[39m
    [2m      Tests [22m [1m[32m128 passed[39m[22m[90m (128)[39m
    [2m   Start at [22m 11:53:03
    [2m   Duration [22m 14.75s[2m (transform 282ms, setup 0ms, collect 1.07s, tests 10.90s, environment 1ms, prepare 830ms)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6`（exit 0）
    ```
     [32m✓[39m src/renderer/components/Editor/lsp/convert.test.ts [2m([22m[2m29 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/shared/gitPublish.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/shared/gitClone.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/workspace/workspaceLifecycle.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/window/portableSplash.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeJump.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeConflict.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/main/window/pasteShortcut.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 2[2mms[22m[39m

    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m98 passed[39m[22m[90m (98)[39m
    [2m   Start at [22m 11:53:19
    [2m   Duration [22m 4.99s[2m (transform 272ms, setup 0ms, collect 1.08s, tests 1.16s, environment 1ms, prepare 885ms)[22m


    ```
  - 耗時：合計 365s｜cmd /c npm run typecheck -- --pretty false 19s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6 204s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6 64s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6 23s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6 34s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6 16s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6 6s
  - sig: 8ef501d80a076a83dcee527bac593b7f3d7bae581fd116d477aca45932e7f177
- **2026-08-13T03:58:28.753Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/remote`（exit 0）
    ```
       [33m[2m✓[22m[39m 租約式遠端分支清理真 Git 鏈路[2m > [22m實際 upstream 名稱不同時預選 upstream，同名 branch 保持未選 [33m 2326[2mms[22m[39m
       [33m[2m✓[22m[39m 租約式遠端分支清理真 Git 鏈路[2m > [22m第二個 endpoint tip 改變時保留新 commit，第一個成功會先 checkpoint [33m 3942[2mms[22m[39m
       [33m[2m✓[22m[39m 租約式遠端分支清理真 Git 鏈路[2m > [22mreceive-pack 隱藏精確 ref 時保持 unknown 且不可預選 [33m 2514[2mms[22m[39m
       [33m[2m✓[22m[39m 租約式遠端分支清理真 Git 鏈路[2m > [22m完成所有 producer endpoint 後以單一 transaction 清 tracking ref、典型 HEAD 與 reflog [33m 3745[2mms[22m[39m
       [33m[2m✓[22m[39m 租約式遠端分支清理真 Git 鏈路[2m > [22m任一非典型 symref 指向 tracking ref 時保留本機 ref [33m 3326[2mms[22m[39m
       [33m[2m✓[22m[39m 租約式遠端分支清理真 Git 鏈路[2m > [22mclaim lease 改變或 object graph 不完整時不送出刪除 [33m 3633[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/remote/refspecMapping.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 11[2mms[22m[39m
     [32m✓[39m src/main/git/cleanup/remote/remoteIdentity.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 3[2mms[22m[39m

    [2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
    [2m      Tests [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m   Start at [22m 11:58:04
    [2m   Duration [22m 24.48s[2m (transform 87ms, setup 0ms, collect 245ms, tests 23.51s, environment 0ms, prepare 237ms)[22m


    ```
  - 耗時：合計 29s｜cmd /c npm run typecheck -- --pretty false 4s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/remote 25s
  - sig: 9a54b8b1cbd1e690ef11bc29fe63bb8ba23db8906632dc09310ea9d94b219120

## 出貨雙軸複核（2026-08-17）

- Standards：檢查 effective push endpoint、expected OID、refspec producer、symref、object graph 與 compare-and-delete 邊界；0 blocker、0 suggestion。
- Spec：逐條核對 8 項驗收條件、票面證據與完整 ship runner；遠端 opt-in、端點租約、tip 競態、部分失敗 checkpoint 與 tracking ref 保留皆有真 Git 證據，0 blocker、0 suggestion。
