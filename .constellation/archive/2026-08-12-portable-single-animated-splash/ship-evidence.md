# Constellation 出貨驗證證據

> 由 `verify-runner.mjs --scope ship` 寫入，證據筆格式與票內完全相同（見 DESIGN.md §5）。

## 驗證證據

- **2026-08-12T00:59:08.042Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6`（exit 0）
    ```
     [32m✓[39m src/main/lsp/serverProbe.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 452[2mms[22m[39m
     [32m✓[39m src/main/git/worktreePath.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 53[2mms[22m[39m
     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 7[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/ptyDataDispatcher.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m tests/security/rendererBaseline.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/main/store/schema.terminalFont.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/gitGraph.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeRemoveModel.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 5[2mms[22m[39m

    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m60 passed[39m[22m[90m (60)[39m
    [2m   Start at [22m 08:20:46
    [2m   Duration [22m 143.18s[2m (transform 2.63s, setup 0ms, collect 14.79s, tests 105.38s, environment 2ms, prepare 7.24s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6`（exit 0）
    ```
     [32m✓[39m src/renderer/components/Terminal/terminalFileLinks.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 8[2mms[22m[39m
     [32m✓[39m src/renderer/state/editorBus.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalWebLinks.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/main/monitor/claudeHookState.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/secureOptions.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m tests/security/spawnEnv.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/SourceControl/fetchCooldown.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m tests/security/conversationAccess.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 3[2mms[22m[39m

    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m88 passed[39m[22m[90m (88)[39m
    [2m   Start at [22m 08:23:22
    [2m   Duration [22m 52.23s[2m (transform 1.52s, setup 0ms, collect 5.39s, tests 27.02s, environment 3ms, prepare 5.29s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6`（exit 0）
    ```
     [32m✓[39m src/renderer/components/Worktree/worktreeDisplay.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 256[2mms[22m[39m
     [32m✓[39m tests/security/worktreePathEscape.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 90[2mms[22m[39m
     [32m✓[39m tests/security/worktreeTrust.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 21[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeSubmit.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/main/lsp/languageRegistry.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/main/store/schema.onboarding.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/monitor/aiProcessScan.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/displayNormalize.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 4[2mms[22m[39m

    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m117 passed[39m[22m[90m (117)[39m
    [2m   Start at [22m 08:24:24
    [2m   Duration [22m 239.11s[2m (transform 2.92s, setup 0ms, collect 8.96s, tests 208.23s, environment 2ms, prepare 5.91s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6`（exit 0）
    ```
       [33m[2m✓[22m[39m fileService readImage（圖片預覽）[2m > [22m不支援副檔名 / 越界路徑 → error [33m 767[2mms[22m[39m
     [32m✓[39m src/main/store/StateStore.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 412[2mms[22m[39m
     [32m✓[39m src/main/claude/statuslineUsage.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 244[2mms[22m[39m
     [32m✓[39m src/main/lsp/LspManager.test.ts [2m([22m[2m23 tests[22m[2m)[22m[33m 408[2mms[22m[39m
     [32m✓[39m src/renderer/state/gitSnapshot.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Dialogs/TrustConfirm.tsx.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/clipboardKeys.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/shared/externalUrl.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 3[2mms[22m[39m

    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m119 passed[39m[22m[90m (119)[39m
    [2m   Start at [22m 08:28:31
    [2m   Duration [22m 173.75s[2m (transform 2.11s, setup 0ms, collect 11.15s, tests 150.21s, environment 2ms, prepare 3.68s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6`（exit 0）
    ```
     [32m✓[39m src/main/git/gitSafeArgs.test.ts [2m([22m[2m42 tests[22m[2m)[22m[32m 6[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/pathDrop.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeModel.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/git/gitErrorClassify.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/store/schema.worktree.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 7[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeConflict.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/shared/gitClone.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Worktree/worktreeJump.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 4[2mms[22m[39m

    [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
    [2m      Tests [22m [1m[32m137 passed[39m[22m[90m (137)[39m
    [2m   Start at [22m 08:31:31
    [2m   Duration [22m 12.57s[2m (transform 855ms, setup 0ms, collect 2.68s, tests 668ms, environment 2ms, prepare 2.76s)[22m


    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6`（exit 0）
    ```
       [33m[2m✓[22m[39m GitService porcelain -z 解析（A4）[2m > [22mchanges 每個 path 對得上磁碟、數量正確（-z + quotePath=false） [33m 4857[2mms[22m[39m
       [33m[2m✓[22m[39m GitService porcelain -z 解析（A4）[2m > [22mstage 以 literal pathspec 只命中指定檔（magic 不生效） [33m 2567[2mms[22m[39m
     [32m✓[39m src/main/git/GitService.clone.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 394[2mms[22m[39m
     [32m✓[39m src/main/ai/usageService.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 48[2mms[22m[39m
     [32m✓[39m src/renderer/layout/layoutPersist.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 14[2mms[22m[39m
     [32m✓[39m src/shared/gitPublish.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/window/pasteShortcut.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/window/portableSplash.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 4[2mms[22m[39m

    [2m Test Files [22m [1m[32m7 passed[39m[22m[90m (7)[39m
    [2m      Tests [22m [1m[32m51 passed[39m[22m[90m (51)[39m
    [2m   Start at [22m 08:31:48
    [2m   Duration [22m 14.79s[2m (transform 436ms, setup 0ms, collect 1.70s, tests 7.89s, environment 1ms, prepare 1.72s)[22m


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
    [2m../../out/renderer/[22m[36massets/jsonMode-DQZcZ5fb.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-D0-nE3Cg.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-ByX4FW4z.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-1_cs5AFR.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-Cdl4q1Oq.js                                       [39m[1m[33m 9,447.31 kB[39m[22m
    [32m✓ built in 54.09s[39m

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=1/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
    MAIN violations: []
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\a11y-axe.spec.ts:52:5 › a11y：開工作區 + 開檔 + 終端機 主介面無 serious/critical 違規 (10.4s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\a11y-keyboard.spec.ts:21:5 › REQ-E2E-011：純鍵盤 新增工作區 → 開檔 → 存檔 (10.4s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\about-version.spec.ts:10:5 › 說明 → 關於 Polydesk：版本號與近版重點；狀態列版本鈕同鏈路 (7.1s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\activitybar-scm-badge.spec.ts:21:5 › 切換工作區時 SCM 圖示顯示目前工作區的未提交檔案數 (16.8s)
      -   6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\agy-dogfood.spec.ts:13:5 › Agy 真實程序已停止徽章 + 實際產生 commit 訊息
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\agy-integration.spec.ts:10:5 › SCM 智慧 commit 引擎可選 Agy (9.2s)
      -   8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\agy-status-dogfood.spec.ts:11:5 › 真實 Agy 啟動停在輸入列顯示已停止，離開後回未啟動
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\app-close.spec.ts:71:5 › REQ-WS-009：有跑中終端機按 X → 確認彈窗 → 確認後 app 完整退出、shell 子程序全滅 (11.5s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\app-close.spec.ts:127:5 › 無跑中終端機按 X → 不彈窗、直接完整退出 (7.9s)
      ok 11 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\app-close.spec.ts:143:5 › 確認彈窗按取消 → 不關閉、終端機仍活；再按 X 確認後退出 (9.2s)

      2 skipped
      9 passed (1.7m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=2/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```

      -   1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\codex-status-dogfood.spec.ts:11:5 › 真實 Codex 啟動停在輸入列顯示已停止，離開後回未啟動
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\delete-trash.spec.ts:7:5 › 檔案總管刪除 → 檔案從樹消失（回收桶）+ danger 按鈕為紅底 (8.2s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\diff-in-editor.spec.ts:11:5 › 點變更檔 → 編輯器區開 diff 分頁（含 Monaco diff） (9.7s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\doc-view.spec.ts:10:5 › docx 開啟為文件預覽：中文內文＋內嵌圖片＋系統開啟按鈕；doc 開啟為純文字 (7.1s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\dock.spec.ts:10:5 › F-10：終端機顯隱 / 一鍵重設 / 重啟還原 (12.2s)
      ok  6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\dogfood-ui.spec.ts:13:5 › dogfood：自訂標題列 + 編輯器切換鈕 + git 線圖 (11.4s)
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-clipboard.spec.ts:62:5 › 複製：鍵盤 Ctrl+C 與右鍵選單 Copy 都寫進系統剪貼簿 (9.2s)
      ok  8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-clipboard.spec.ts:92:5 › 貼上：右鍵選單 Paste 與 Ctrl+V 都貼進編輯器 (8.4s)
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-conflict.spec.ts:26:5 › REQ-E2E-009：外部修改不再彈窗打斷；關檔時才提醒（不儲存） (8.7s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-conflict.spec.ts:55:5 › REQ-E2E-009：關檔時選儲存 → 磁碟已被外部改 → 覆蓋存回我的編輯 (8.7s)

      1 skipped
      9 passed (1.4m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=3/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```

    Running 9 tests using 1 worker, shard 3 of 12

      ok 1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-external-refresh.spec.ts:7:5 › 外部變更即時對帳，右鍵關閉全部只處理目前工作區且尊重取消 (9.4s)
      ok 2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-reveal-on-open.spec.ts:10:5 › 編輯器隱藏時點檔案：自動顯示編輯器並開檔（含已開分頁再點） (7.4s)
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-toggle-terminal.spec.ts:10:5 › 關閉編輯器：終端機原地存活、不重建、版面正常（問題3 迴歸） (8.6s)
      ok 4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\editor-ws-tabs.spec.ts:7:5 › 切換工作區只見該工作區分頁；切回還原原分頁與內容 (8.7s)
      ok 5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-drop.spec.ts:20:5 › OS 拖檔進檔案總管：空白區→複製到根；資料夾列→複製進該資料夾 (7.3s)
      ok 6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-drop.spec.ts:58:5 › app 內部拖曳（樹列→樹）不觸發匯入：無 Files 型別一律忽略 (7.9s)
      ok 7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-edit.spec.ts:7:5 › 檔案總管右鍵：新增檔案 → 改名 → 刪除 (8.8s)
      ok 8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-edit.spec.ts:48:5 › 隱藏編輯器時點檔 → 編輯器自動顯示回來 (6.7s)
      ok 9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-edit.spec.ts:72:5 › 右鍵「複製路徑／複製相對路徑」→ 系統剪貼簿真的有正確路徑（clipboard IPC，非被封鎖的 navigator.clipboard） (8.8s)

      9 passed (1.3m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=4/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```

      ok  1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-paste.spec.ts:42:5 › 貼上外部檔案：fileUtils 已暴露 + importFiles 複製進工作區並自動顯示 (8.1s)
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-paste.spec.ts:82:5 › 真實 Ctrl+V：非可編輯焦點下也能貼入外部檔案（paste catcher） (12.8s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-paste.spec.ts:109:5 › 真實 Ctrl+V：截圖 bitmap 沒有磁碟路徑時會轉成 PNG 貼入工作區 (8.7s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\explorer-paste.spec.ts:140:5 › 虛擬圖片檔：只有 Files 且 MIME 非 image 時仍會從系統剪貼簿貼入 (7.5s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-branch-management.spec.ts:45:5 › 分支管理：本地／遠端分組、雙入口、阻擋原因與安全刪除真鏈路 (34.6s)
      ok  6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-commit-actions.spec.ts:11:5 › commit hover 卡片 + 右鍵選單（開啟此 commit 變更 / 從此 commit 建分支） (12.9s)
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-fetch-behind.spec.ts:38:5 › PE-4：遠端進新 commit → fetch 後線圖可見遠端版本，並顯示 ↓1 未拉取 (26.6s)
      ok  8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-graph-branch.spec.ts:32:5 › A 線圖：分支+合併多 lane，且列高=SVG高（跨列無縫、線不斷） (14.5s)
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-graph-branch.spec.ts:68:5 › C ref 徽章：本地 main（HEAD）與遠端 origin/main 各標在所在 commit（like VSCode） (10.9s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-graph-branch.spec.ts:101:5 › B 切換分支：未提交變更 → 彈窗 Stash 並切換、變更不丟 (16.5s)
      ok 11 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-graph-branch.spec.ts:135:5 › B2 切換分支：untracked 檔擋 checkout → stash -u 並切換、檔案不丟（審查 HIGH 修復） (17.6s)

      11 passed (2.9m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=5/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok  1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-publish.spec.ts:36:5 › 沒 upstream 的新分支按 push → 自動 push -u 設 upstream（全真鏈路） (18.7s)
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-publish.spec.ts:75:5 › 無 remote → 同步列顯示「發佈」；名稱驗證；gh 缺席給安裝引導 (11.2s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-publish.spec.ts:116:5 › 發佈成功路徑：gh shim 收到完整參數、UI 顯示已發佈 URL (16.2s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git.spec.ts:35:5 › REQ-E2E-003：編輯→變更出現→stage→commit→清空、ahead+1 (15.2s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git.spec.ts:65:5 › 整合終端或外部 push 後 SCM 自動清除過期的未推送數字 (22.0s)
      ok  6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\image-view.spec.ts:12:5 › png 開啟為圖片預覽（非 Monaco 亂碼），像素真的載入 (5.7s)
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\layout-close-size.spec.ts:19:5 › dockview 標頭 × 原地隱藏編輯器或終端機，側欄尺寸維持 (5.9s)
      ok  8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\lsp.spec.ts:18:5 › REQ-E2E-002 後半：開 .py（無 LSP）→ 缺件提示 + 仍可編輯存檔 (6.8s)
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\onboarding-help.spec.ts:33:5 › 首次導覽會保存進度、續接並在完成後不再自動出現 (17.2s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\onboarding-help.spec.ts:79:5 › schema v2 與舊導覽版本從第 1 步開始，缺少目標時提供不阻塞替代內容 (13.4s)
      ok 11 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\onboarding-help.spec.ts:107:5 › 說明與設定共用入口可搜尋完整指南，手動導覽不改寫首次狀態 (11.2s)
      ok 12 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\onboarding-help.spec.ts:157:5 › 導覽只還原自己顯示且未被使用者覆寫的區域 (7.5s)

      12 passed (2.5m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=6/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      "idleCpu": {
        "pct": 4.7,
        "workspaces": 10,
        "windowMs": 18000,
        "budget": 10
      }
    }
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\perf.spec.ts:156:5 › REQ-MON-006 N=10 背景閒置監控 CPU 低水位 (34.3s)
      ok 4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\rail-resize.spec.ts:11:5 › 工作區欄可拖曳調寬 + 重啟持久化 (27.9s)
      ok 5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\reset-layout-terminal.spec.ts:9:5 › 開終端機 → 重設版面 → 終端機面板不被重建（分頁/PTY 保留） (15.5s)
      ok 6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\scm-dogfood2.spec.ts:24:5 › untracked diff 整檔新增 + 右鍵加 .gitignore + 右鍵取消變更 (21.9s)
      ok 7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\scm-dogfood2.spec.ts:61:5 › 點 commit 展開變更檔案清單 → 點檔開單檔 commit diff (13.0s)

      7 passed (2.3m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=7/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      "extraGitLogRequests": 0
    }
      ok  1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\scm-performance.spec.ts:21:5 › 大量變更分批渲染，檔案事件不重複掃 Git 或重載歷史 (25.3s)
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\search.spec.ts:19:5 › REQ-E2E-006：全域搜尋串流結果（排除 node_modules）→點命中跳檔 (8.3s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\search.spec.ts:45:5 › 檔名搜尋：命中列「檔案」群組點了開檔；內容命中點擊跳行並反白命中片段 (9.7s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\sheet-view.spec.ts:8:5 › xlsx 開啟為表格預覽（非亂碼），儲存格值正確 (7.1s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\shell.spec.ts:6:5 › 外殼渲染 + 主題即時切換 + 重啟沿用 (REQ-E2E-007) (14.6s)
      ok  6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:32:5 › splash 原生 show 事件在視窗建立後立即發生，主視窗就緒後立即收尾 (8.4s)
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:86:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (8.5s)
      ok  8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:102:5 › 主畫面載入失敗時可從 splash 確實退出 (7.3s)
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\stash-untracked.spec.ts:11:5 › 手動 Stash 含 untracked：收起新檔 + Stash Pop 取回 (24.9s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-ai-launch.spec.ts:38:5 › Claude bypass / Codex / Agy 按鈕會各開終端機並送出對應命令 (30.3s)

      10 passed (2.4m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=8/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
    Running 10 tests using 1 worker, shard 8 of 12

      ok  1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-bottom-visibility.spec.ts:54:5 › 終端機底列可視性：xterm/ConPTY/DOM 三方一致，填滿整屏後最後一列可見 (16.9s)
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-clipboard.spec.ts:43:5 › Ctrl+V 把剪貼簿內容貼進終端機（真 shell 執行建檔） (15.5s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-clipboard.spec.ts:71:5 › 右鍵（無選取）貼上剪貼簿內容進終端機 (15.0s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-clipboard.spec.ts:100:5 › 同工作區兩個終端機：A 選取後 Ctrl+C 可複製到 B，無選取仍保留 SIGINT (13.5s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-clipboard.spec.ts:182:5 › OSC52 寫入：真 shell 發序列 → 系統剪貼簿更新（Claude Code 選取複製鏈路） (11.8s)
      ok  6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-clipboard.spec.ts:213:5 › 右鍵貼上防抖：300ms 內第二次右鍵只貼一次；窗過後可再貼 (14.3s)
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-drop.spec.ts:45:5 › 側欄拖檔到終端機：貼上絕對路徑；含空白檔名自動包引號；裸 text/plain 不誤貼 (11.3s)
      ok  8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-file-link.spec.ts:8:5 › Ctrl+點擊終端機工作區路徑：在 Polydesk 編輯器開檔並跳到行欄 (10.6s)
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-file-link.spec.ts:78:5 › Ctrl+點擊 Claude Read 工具輸出：開啟括號內路徑並套用 lines 起始行 (11.2s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-file-link.spec.ts:152:5 › 工作區外檔案：主程序確認後才外開，危險腳本一律封鎖 (8.6s)

      10 passed (2.2m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=9/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```

      ok  1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-fit-clip.spec.ts:39:5 › 終端機放大/小幅縮放後，最後一列不被裁切（畫布不溢出 host） (10.1s)
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-fit-clip.spec.ts:102:5 › 切主題時已開的終端機即時跟隨（dogfood 回報：切風格終端機不變） (8.9s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-fit-clip.spec.ts:132:5 › 終端機容器底色＝xterm 背景色（整數格剩餘空間不露出主題底色＝無留白框） (9.0s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-font.spec.ts:9:5 › 終端機字型：預設 Consolas 14 → 面板切 JetBrains Mono 即時套用並持久化；unicode11 生效 (9.2s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-header.spec.ts:11:5 › 面板 ✕ 隱藏（setVisible，不 dispose）+ 工具列再開即現 (9.6s)
      ok  6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-keycap.spec.ts:35:5 › REQ-TERM-009：真 PTY 輸出 keycap 1️⃣ → buffer 退化成純數字、無 U+20E3 圍框 (13.1s)
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-manage.spec.ts:13:5 › 顯示/隱藏：隱藏一個終端機＝移出並排但不關閉（同一 xterm DOM 存活），再顯示即回來 (11.2s)
      ok  8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-manage.spec.ts:55:5 › 雙擊迷你標頭 → 就地改名，未命名時自動編號 (11.1s)
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-manage.spec.ts:86:5 › 拖曳迷你標頭 → 調整並排順序 (11.3s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-manage.spec.ts:125:5 › 拖曳排序（往後拖）：把前面的 pane 拖到後面也要能動 (13.1s)
      ok 11 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-manage.spec.ts:162:5 › 改名按 Escape 取消 → 不保存（沿用原名） (8.8s)

      11 passed (1.9m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=10/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      "rendererWorkingSetMb": 186.2,
      "budgets": {
        "frameP95Ms": 50,
        "rendererCpuPct": 25
      }
    }
      ok 1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-multi-workspace-perf.spec.ts:47:5 › 四工作區 AI 串流時 renderer 維持可互動且資源成本有上限 (33.3s)
      ok 2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-path-regression.spec.ts:9:5 › System32 位於 PATH 最後且沒有尾分號時仍可建立 PowerShell (8.5s)
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-path-regression.spec.ts:34:5 › shell 不存在時顯示結構化錯誤，不再像按鈕沒有反應 (7.4s)
      ok 4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-resize-heal.spec.ts:40:5 › PTY 尺寸漂移後持續輸出即自癒（不必重新點擊，ConPTY rows 回到 xterm rows） (18.1s)
      ok 5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-rightclick-tui.spec.ts:26:5 › TUI 滑鼠模式下右鍵貼上：PTY 不收滑鼠回報、marker 恰寫入一次 (13.5s)
      ok 6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-scroll-follow.spec.ts:59:5 › 孤兒 isUserScrolling 旗標下大量輸出，viewport 仍跟到底（展開不再吃掉底部） (19.7s)

      6 passed (1.7m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=11/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok  1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-split.spec.ts:8:5 › 多開終端機 → 並排同時顯示 + 拖曳分隔條 + 切上下 + 關閉 (11.2s)
      ok  2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal-web-link.spec.ts:7:5 › Ctrl+點擊終端機 HTTP 網址：由系統瀏覽器外開，一般點擊不觸發 (13.6s)
      ok  3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\terminal.spec.ts:15:5 › REQ-E2E-008：跑中終端機 → 移除工作區彈關閉確認 → 確認後移除 (11.7s)
      ok  4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\toggle-terminal.spec.ts:9:5 › toggle 終端機顯隱：setVisible 不 dispose、隱藏騰出空間、再開原地重現 (9.3s)
      ok  5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace-rail.spec.ts:10:5 › 工作區列可 toggle 顯隱 (6.5s)
      ok  6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace-rail.spec.ts:25:5 › 重設版面也還原工作區 rail 寬度 (6.2s)
      ok  7 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace-switch-badge.spec.ts:9:5 › 點工作區列項的徽章格（非名字按鈕）也能切換工作區（整列可點） (7.6s)
      ok  8 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace-switch-stale.spec.ts:10:5 › bug1：快速切換時前一工作區的慢 git 載入不覆蓋當前（取消 stale） (20.7s)
      ok  9 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace.spec.ts:17:5 › REQ-E2E-001：歡迎頁→新增 A→新增 B→切 A→切 B（真實點擊） (10.0s)
      ok 10 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace.spec.ts:42:5 › 空白歡迎頁可開啟 Clone Git Repository 對話框 (7.6s)
      ok 11 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace.spec.ts:55:5 › F-1-A1：惡意名稱（含 <img onerror>）改名後不產生 DOM 節點（無 XSS） (7.4s)
      ok 12 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\workspace.spec.ts:82:5 › REQ-E2E-002（前半）：開 TS 檔→輸入→Ctrl+S 存檔，磁碟更新 (7.6s)

      12 passed (2.0m)

    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=12/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      "worktreeCreate": {
        "p50": 3226,
        "p95": 3226,
        "n": 1,
        "budget": 5000
      }
    }
      ok 2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\worktree-perf.spec.ts:130:5 › REQ-PERF-006：建立 worktree p95 < 5s（UI 不凍結） (17.4s)
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\worktree.spec.ts:30:5 › REQ-E2E-012：分支→建立 worktree→納管開啟→終端機 cwd＝worktree→切回主 repo (21.4s)
      ok 4 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\worktree.spec.ts:71:5 › REQ-E2E-013：移除 worktree——dirty 兩段確認→連同刪除；僅移出保留資料夾 (1.2m)
      ok 5 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\worktree.spec.ts:148:5 › worktree 移除相容舊資料：一般工作區加入時兩種移除都有效 (27.0s)
      ok 6 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\worktree.spec.ts:185:5 › F-13：分支分頁「在新 worktree 開啟」建立；checkout 衝突→跳到該 worktree (43.8s)

      6 passed (3.2m)

    ```
  - 耗時：合計 2340s｜cmd /c npm run typecheck -- --pretty false 24s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6 158s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6 65s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6 249s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6 181s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6 19s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6 19s｜cmd /c npm run build 63s｜cmd /c npm run e2e -- --workers=1 --shard=1/12 --grep-invert "REQ-PERF-001" 103s｜cmd /c npm run e2e -- --workers=1 --shard=2/12 --grep-invert "REQ-PERF-001" 89s｜cmd /c npm run e2e -- --workers=1 --shard=3/12 --grep-invert "REQ-PERF-001" 77s｜cmd /c npm run e2e -- --workers=1 --shard=4/12 --grep-invert "REQ-PERF-001" 174s｜cmd /c npm run e2e -- --workers=1 --shard=5/12 --grep-invert "REQ-PERF-001" 154s｜cmd /c npm run e2e -- --workers=1 --shard=6/12 --grep-invert "REQ-PERF-001" 141s｜cmd /c npm run e2e -- --workers=1 --shard=7/12 --grep-invert "REQ-PERF-001" 149s｜cmd /c npm run e2e -- --workers=1 --shard=8/12 --grep-invert "REQ-PERF-001" 133s｜cmd /c npm run e2e -- --workers=1 --shard=9/12 --grep-invert "REQ-PERF-001" 119s｜cmd /c npm run e2e -- --workers=1 --shard=10/12 --grep-invert "REQ-PERF-001" 104s｜cmd /c npm run e2e -- --workers=1 --shard=11/12 --grep-invert "REQ-PERF-001" 123s｜cmd /c npm run e2e -- --workers=1 --shard=12/12 --grep-invert "REQ-PERF-001" 195s
  - sig: 20d8a5cc5b48993627e83693a927936155b20c7c584f15761f41daac42b4a408
