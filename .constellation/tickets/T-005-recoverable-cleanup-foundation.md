# T-005 可恢復清理基礎
status: done
blocked-by:
zone: src/shared/**, src/preload/**, src/main/git/cleanup/core/**, src/main/store/cleanup/**, src/main/ipc/router.ts, src/main/git/cleanup/**/*.test.ts

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

建立所有分支／worktree／遠端刪除入口共用的 preview、execute 與恢復契約；任何破壞性步驟前都有可驗證、可互斥、可從當機狀態重建的 repository 級 journal 與 lease，單純 preview 保證零副作用。

## 驗收條件（合成階段寫定，逐條可勾）
- [x] 對真 Git repository 執行 preview 後，branch、worktree、config、reflog、磁碟與遠端狀態逐項比對均完全不變，回應則包含 baseline、retained refs、worktree HEAD、metadata、object graph 與可切換分支的結構化 snapshot。
- [x] prepared、mutating、每步 checkpoint 與 closed journal 均以版本化 envelope/payload checksum、原子取代與 fsync 順序落盤；模擬各落盤窗口中止後，啟動 reconciliation 會補 claim、維持阻擋或完成關閉，不會同 repo 建出第二份本機清理。
- [x] payload 損壞、envelope 損壞、未知 schema、index/journal 不一致與無法歸屬狀態均進 quarantine 並 fail-closed；人工封存 mutating 項目不會釋放 claim，零副作用證據完整時才可取消。
- [x] 同 common-dir 路徑重新 init/clone 會得到新 repository instance generation；舊 journal/receipt 不會自動套用到新 repository，同 instance 移動則經 evidence 重驗後可恢復。
- [x] Git capability 與 in-progress operation marker 以 Git 解析出的 repository/worktree path 探測；marker 未知、reflog drop 不支援、private refs 無法列舉或 object graph 不完整時回傳明確 blocked/unknown，不降級猜測。
- [x] cleanup shared IPC 只暴露固定白名單與結構化 request/response，不暴露 raw path、URL、token、Node API 或任意 Git 參數。

## 決議記錄（實作期小事自決落此，可追溯）

- 共用基礎採 expand 形態；舊 branch/worktree delete IPC 保留到 T-008 統一切換後才 contract，避免中途破壞既有操作。
- Windows 原子落盤採 writable file handle 執行 `fsync`；目錄 `fsync` 只在支援的平台執行，避免把 Windows 的 `EPERM` 當作 durability 成功。
- 完整 preview 的本機 Git timeout 獨立設為 30 秒；一般 Git 操作仍維持 10 秒，避免防毒冷啟動讓同一份 lease 被誤判成 unknown。
- 票面驗證標題原先帶說明後綴，runner 保守退回 config 全量六分片；本輪採該次更強證據關票，並把標題校正供後續重跑。

## 驗證指令
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup src/main/store`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-08-13T01:44:17.031Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    
    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6`（exit 0）
    ```
     [32m✓[39m src/main/lsp/serverProbe.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 292[2mms[22m[39m
     [32m✓[39m src/main/git/worktreePath.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 87[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/gitGraph.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/ptyDataDispatcher.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m tests/security/rendererBaseline.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/main/store/schema.terminalFont.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeRemoveModel.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 3[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m60 passed[39m[22m[90m (60)[39m
    [2m   Start at [22m 09:32:30
    [2m   Duration [22m 83.01s[2m (transform 2.09s, setup 0ms, collect 13.91s, tests 54.15s, environment 2ms, prepare 4.86s)[22m
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6`（exit 0）
    ```
       [33m[2m✓[22m[39m installClaudeStatusHooks — 真實 fs 安裝（temp HOME）[2m > [22mhook 腳本 end(SessionEnd)：刪本 session 狀態檔 [33m 1338[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalFileLinks.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/main/monitor/claudeHookState.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalWebLinks.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/state/editorBus.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m tests/security/spawnEnv.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m tests/security/conversationAccess.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/fetchCooldown.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 3[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m86 passed[39m[22m[90m (86)[39m
    [2m   Start at [22m 09:33:57
    [2m   Duration [22m 277.03s[2m (transform 3.52s, setup 0ms, collect 19.21s, tests 239.99s, environment 2ms, prepare 4.76s)[22m
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6`（exit 0）
    ```
     [32m✓[39m tests/security/worktreePathEscape.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 40[2mms[22m[39m
     [32m✓[39m tests/security/worktreeTrust.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 15[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeSubmit.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/monitor/aiProcessScan.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/lsp/languageRegistry.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/main/store/schema.onboarding.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/secureOptions.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/displayNormalize.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 3[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m108 passed[39m[22m[90m (108)[39m
    [2m   Start at [22m 09:38:52
    [2m   Duration [22m 133.10s[2m (transform 1.48s, setup 0ms, collect 4.17s, tests 120.00s, environment 2ms, prepare 2.74s)[22m
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6`（exit 0）
    ```
     [32m✓[39m src/main/store/StateStore.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 994[2mms[22m[39m
     [32m✓[39m src/main/lsp/LspManager.test.ts [2m([22m[2m23 tests[22m[2m)[22m[33m 551[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeDisplay.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 225[2mms[22m[39m
     [32m✓[39m src/main/claude/statuslineUsage.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 1138[2mms[22m[39m
     [32m✓[39m src/main/monitor/ClaudeStatusMonitor.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 11[2mms[22m[39m
     [32m✓[39m src/renderer/components/Dialogs/TrustConfirm.tsx.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/shared/externalUrl.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/clipboardKeys.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 3[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m116 passed[39m[22m[90m (116)[39m
    [2m   Start at [22m 09:41:09
    [2m   Duration [22m 75.90s[2m (transform 3.03s, setup 0ms, collect 11.45s, tests 47.08s, environment 2ms, prepare 5.06s)[22m
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6`（exit 0）
    ```
     [32m✓[39m src/main/monitor/agyLog.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 59[2mms[22m[39m
     [32m✓[39m src/main/store/schema.worktree.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/git/gitSafeArgs.test.ts [2m([22m[2m42 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/pathDrop.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeModel.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/state/gitSnapshot.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/main/git/gitErrorClassify.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeConflict.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m121 passed[39m[22m[90m (121)[39m
    [2m   Start at [22m 09:42:35
    [2m   Duration [22m 73.54s[2m (transform 1.36s, setup 0ms, collect 4.09s, tests 56.46s, environment 2ms, prepare 3.47s)[22m
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6`（exit 0）
    ```
     [32m✓[39m src/main/ai/usageService.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 45[2mms[22m[39m
     [32m✓[39m src/renderer/layout/layoutPersist.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 16[2mms[22m[39m
     [32m✓[39m src/renderer/components/Editor/lsp/convert.test.ts [2m([22m[2m29 tests[22m[2m)[22m[32m 14[2mms[22m[39m
     [32m✓[39m src/shared/gitPublish.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeJump.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/shared/gitClone.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/window/pasteShortcut.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 2[2mms[22m[39m
     [32m✓[39m src/main/window/portableSplash.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 3[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m10 passed[39m[22m[90m (10)[39m
    [2m      Tests [22m [1m[32m92 passed[39m[22m[90m (92)[39m
    [2m   Start at [22m 09:43:55
    [2m   Duration [22m 21.24s[2m (transform 940ms, setup 0ms, collect 2.94s, tests 11.85s, environment 2ms, prepare 2.02s)[22m
    
    
    ```
  - 耗時：合計 755s｜cmd /c npm run typecheck -- --pretty false 35s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6 96s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6 282s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6 151s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6 79s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6 85s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6 27s
  - sig: 94284d8266d0ed222694983903fd49d08bc09a2c28774e3f79d8eb84242d3e61
- **2026-08-13T01:52:51.175Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    
    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup src/main/store`（exit 0）
    ```
       [33m[2m✓[22m[39m CleanupJournalStore[2m > [22mprepared envelope 是 claim 真值，index 遺失時會重建且阻擋同 repo 第二份本機清理 [33m 1655[2mms[22m[39m
       [33m[2m✓[22m[39m CleanupJournalStore[2m > [22mpayload 損壞會 quarantine 並保留 repository claim，人工封存也不解鎖 mutating claim [33m 1771[2mms[22m[39m
       [33m[2m✓[22m[39m CleanupJournalStore[2m > [22mmutating checkpoint 會先更新 payload checksum 再推進 envelope generation [33m 890[2mms[22m[39m
       [33m[2m✓[22m[39m CleanupJournalStore[2m > [22m無法驗證 envelope 歸屬時全域 fail-closed [33m 320[2mms[22m[39m
     [32m✓[39m src/main/store/StateStore.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 497[2mms[22m[39m
     [32m✓[39m src/main/store/schema.terminalFont.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/store/schema.onboarding.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/store/schema.worktree.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 7[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m7 passed[39m[22m[90m (7)[39m
    [2m      Tests [22m [1m[32m39 passed[39m[22m[90m (39)[39m
    [2m   Start at [22m 09:48:41
    [2m   Duration [22m 248.95s[2m (transform 682ms, setup 0ms, collect 1.99s, tests 237.36s, environment 1ms, prepare 2.87s)[22m
    
    
    ```
  - 耗時：合計 278s｜cmd /c npm run typecheck -- --pretty false 21s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup src/main/store 257s
  - sig: 11958738409c45a1115a681744d0d6ac64c927e72939b3eb21ef363ce0de6382
- **2026-08-13T01:59:34.403Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    
    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false
    
    
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup src/main/store`（exit 0）
    ```
     [32m✓[39m src/main/store/cleanup/CleanupJournalStore.test.ts [2m([22m[2m5 tests[22m[2m)[22m[33m 1709[2mms[22m[39m
       [33m[2m✓[22m[39m CleanupJournalStore[2m > [22mpayload 損壞會 quarantine 並保留 repository claim，人工封存也不解鎖 mutating claim [33m 367[2mms[22m[39m
       [33m[2m✓[22m[39m CleanupJournalStore[2m > [22mmutating checkpoint 會先更新 payload checksum 再推進 envelope generation [33m 351[2mms[22m[39m
       [33m[2m✓[22m[39m CleanupJournalStore[2m > [22mrepository generation 辨識同路徑替換，實體目錄移動則保留世代 [33m 496[2mms[22m[39m
     [32m✓[39m src/main/store/StateStore.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 1188[2mms[22m[39m
     [32m✓[39m src/main/store/schema.worktree.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/main/store/schema.terminalFont.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/store/schema.onboarding.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 3[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m7 passed[39m[22m[90m (7)[39m
    [2m      Tests [22m [1m[32m39 passed[39m[22m[90m (39)[39m
    [2m   Start at [22m 09:55:39
    [2m   Duration [22m 233.92s[2m (transform 281ms, setup 0ms, collect 1.08s, tests 227.10s, environment 1ms, prepare 1.88s)[22m
    
    
    ```
  - 耗時：合計 263s｜cmd /c npm run typecheck -- --pretty false 17s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup src/main/store 247s
  - sig: 16067753885fc2b23f9be1cd33b3b3b31a2c02320cad7940e65d90907437cd49

## 出貨雙軸複核（2026-08-17）

- Standards：從基準 `652ebe4` 檢查 shared IPC、repository queue、lease、journal、claim、quarantine 與失敗收斂邊界；0 blocker、0 suggestion。
- Spec：逐條核對 6 項驗收條件、票面證據與完整 ship runner；preview 零副作用、互斥、checksum／generation 驗證與恢復契約皆有真鏈路證據，0 blocker、0 suggestion。
