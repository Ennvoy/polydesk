# Constellation 出貨驗證證據

> 由 `verify-runner.mjs --scope ship` 寫入，證據筆格式與票內完全相同（見 DESIGN.md §5）。

## 失敗紀錄 2026-10-12T11:14:58.696Z

- `cmd /c npm run typecheck -- --pretty false`（exit 0，19s）：> tsc --noEmit --pretty false
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6`（exit 0，709s）：   Duration  703.16s (transform 1.24s, setup 0ms, collect 11.56s, tests 676.44s, environment 5ms, prepare 5.59s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6`（exit 0，541s）：   Duration  534.60s (transform 1.08s, setup 0ms, collect 3.75s, tests 520.68s, environment 3ms, prepare 3.11s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6`（exit 0，72s）：   Duration  66.84s (transform 1.01s, setup 0ms, collect 4.25s, tests 52.65s, environment 3ms, prepare 3.10s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6`（exit 0，107s）：   Duration  102.24s (transform 961ms, setup 0ms, collect 8.28s, tests 84.58s, environment 3ms, prepare 3.23s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6`（exit 0，60s）：   Duration  55.39s (transform 796ms, setup 0ms, collect 4.60s, tests 40.87s, environment 3ms, prepare 3.12s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6`（exit 0，53s）：   Duration  48.60s (transform 656ms, setup 0ms, collect 5.92s, tests 35.25s, environment 2ms, prepare 2.42s)
- `cmd /c npm run build`（exit 0，75s）：✓ built in 1m 7s
- `cmd /c npm run e2e -- --workers=1 --shard=1/12 --grep-invert "REQ-PERF-001"`（exit 0，94s）：  11 passed (1.5m)
- `cmd /c npm run e2e -- --workers=1 --shard=2/12 --grep-invert "REQ-PERF-001"`（exit 0，98s）：  11 passed (1.6m)
- `cmd /c npm run e2e -- --workers=1 --shard=3/12 --grep-invert "REQ-PERF-001"`（exit 1，1084s）：  12 passed (18.0m)

未簽章：此段僅供追查耗時與髒資料來源，不參與關票與出貨判定。

## 失敗紀錄 2026-10-12T13:30:34.403Z

- `cmd /c npm run typecheck -- --pretty false`（exit 0，17s）：> tsc --noEmit --pretty false
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6`（exit 0，413s）：   Duration  408.47s (transform 937ms, setup 0ms, collect 7.29s, tests 391.32s, environment 3ms, prepare 3.44s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6`（exit 0，479s）：   Duration  472.98s (transform 917ms, setup 0ms, collect 3.85s, tests 458.27s, environment 3ms, prepare 3.37s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6`（exit 0，72s）：   Duration  68.46s (transform 974ms, setup 0ms, collect 4.38s, tests 52.68s, environment 4ms, prepare 3.65s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6`（exit 0，148s）：   Duration  144.55s (transform 916ms, setup 0ms, collect 10.04s, tests 122.78s, environment 3ms, prepare 3.71s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6`（exit 0，63s）：   Duration  58.60s (transform 732ms, setup 0ms, collect 4.29s, tests 43.51s, environment 3ms, prepare 3.44s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6`（exit 0，59s）：   Duration  54.46s (transform 816ms, setup 0ms, collect 6.85s, tests 37.30s, environment 3ms, prepare 3.29s)
- `cmd /c npm run build`（exit 0，84s）：✓ built in 1m 15s
- `cmd /c npm run e2e -- --workers=1 --shard=1/12 --grep-invert "REQ-PERF-001"`（exit 0，103s）：  11 passed (1.7m)
- `cmd /c npm run e2e -- --workers=1 --shard=2/12 --grep-invert "REQ-PERF-001"`（exit 0，100s）：  11 passed (1.6m)
- `cmd /c npm run e2e -- --workers=1 --shard=3/12 --grep-invert "REQ-PERF-001"`（exit 0，473s）：  13 passed (7.8m)
- `cmd /c npm run e2e -- --workers=1 --shard=4/12 --grep-invert "REQ-PERF-001"`（exit 0，279s）：  14 passed (4.6m)
- `cmd /c npm run e2e -- --workers=1 --shard=5/12 --grep-invert "REQ-PERF-001"`（exit 0，117s）：  6 passed (1.9m)
- `cmd /c npm run e2e -- --workers=1 --shard=6/12 --grep-invert "REQ-PERF-001"`（exit 1，158s）：  10 passed (2.6m)

未簽章：此段僅供追查耗時與髒資料來源，不參與關票與出貨判定。

## 驗證證據

- **2026-10-12T14:51:15.167Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    > polydesk@0.40.0 typecheck
    > tsc --noEmit --pretty false
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6`（exit 0）
    ```
     ✓ src/renderer/components/Terminal/ptyDataDispatcher.test.ts (1 test) 4ms
     ✓ src/renderer/components/SourceControl/gitGraph.test.ts (6 tests) 4ms
     ✓ src/renderer/components/Worktree/worktreeRemoveModel.test.ts (6 tests) 5ms
     ✓ tests/security/rendererBaseline.test.ts (8 tests) 5ms
     Test Files  15 passed (15)
          Tests  92 passed (92)
       Start at  21:54:58
       Duration  405.11s (transform 948ms, setup 0ms, collect 7.36s, tests 387.21s, environment 4ms, prepare 3.46s)
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6`（exit 0）
    ```
     ✓ src/main/git/cleanup/remote/remoteIdentity.test.ts (2 tests) 4ms
     ✓ src/renderer/components/SourceControl/fetchCooldown.test.ts (4 tests) 5ms
     ✓ tests/security/spawnEnv.test.ts (5 tests) 5ms
     ✓ tests/security/conversationAccess.test.ts (1 test) 5ms
     Test Files  15 passed (15)
          Tests  118 passed (118)
       Start at  22:01:48
       Duration  500.69s (transform 852ms, setup 0ms, collect 3.56s, tests 486.10s, environment 3ms, prepare 3.47s)
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6`（exit 0）
    ```
     ✓ src/renderer/components/SourceControl/cleanupFeedback.test.ts (3 tests) 5ms
     ✓ src/renderer/components/SourceControl/metadataReadCache.test.ts (2 tests) 3ms
     ✓ src/main/lsp/languageRegistry.test.ts (16 tests) 6ms
     ✓ src/main/git/cleanup/local/worktreeReconciliation.test.ts (8 tests) 5ms
     Test Files  15 passed (15)
          Tests  118 passed (118)
       Start at  22:10:13
       Duration  67.42s (transform 936ms, setup 0ms, collect 3.86s, tests 53.44s, environment 3ms, prepare 3.25s)
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6`（exit 0）
    ```
     ✓ src/main/store/schema.onboarding.test.ts (8 tests) 5ms
     ✓ tests/security/worktreeTrust.test.ts (6 tests) 4ms
     ✓ src/renderer/components/Terminal/clipboardKeys.test.ts (8 tests) 3ms
     ✓ src/shared/externalUrl.test.ts (2 tests) 3ms
     Test Files  15 passed (15)
          Tests  133 passed (133)
       Start at  22:11:25
       Duration  138.72s (transform 948ms, setup 0ms, collect 8.88s, tests 119.33s, environment 3ms, prepare 3.31s)
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6`（exit 0）
    ```
     ✓ src/renderer/components/Worktree/worktreeModel.test.ts (9 tests) 9ms
     ✓ src/renderer/components/Worktree/worktreeJump.test.ts (7 tests) 5ms
     ✓ src/renderer/state/gitSnapshot.test.ts (3 tests) 6ms
     ✓ src/renderer/components/Worktree/worktreeConflict.test.ts (5 tests) 5ms
     Test Files  15 passed (15)
          Tests  152 passed (152)
       Start at  22:13:48
       Duration  58.32s (transform 849ms, setup 0ms, collect 4.57s, tests 43.23s, environment 4ms, prepare 3.38s)
    ```
  - `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6`（exit 0）
    ```
     ✓ src/shared/gitPublish.test.ts (7 tests) 4ms
     ✓ src/renderer/components/SourceControl/gitErrorFeedback.test.ts (10 tests) 8ms
     ✓ src/shared/gitClone.test.ts (5 tests) 6ms
     ✓ src/main/window/pasteShortcut.test.ts (3 tests) 4ms
     Test Files  13 passed (13)
          Tests  110 passed (110)
       Start at  22:14:51
       Duration  52.12s (transform 738ms, setup 0ms, collect 6.55s, tests 36.51s, environment 3ms, prepare 2.81s)
    ```
  - `cmd /c npm run build`（exit 0）
    ```
    ../../out/renderer/assets/solidity-yHOxYChb.js                                        26.03 kB
    ../../out/renderer/assets/jsonMode-auE1hRq9.js                                        29.12 kB
    ../../out/renderer/assets/tsMode-DIRboYYm.js                                          40.32 kB
    ../../out/renderer/assets/freemarker2-BWYE2rir.js                                     42.10 kB
    ../../out/renderer/assets/lspLanguageFeatures-BTrcuYZz.js                             61.69 kB
    ../../out/renderer/assets/addon-webgl-BEDhrLCz.js                                    139.86 kB
    ../../out/renderer/assets/index-ftuEnPkq.js                                        9,644.27 kB
    ✓ built in 1m 6s
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=1/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok  9 e2e\app-close.spec.ts:71:5 › REQ-WS-009：有跑中終端機按 X → 確認彈窗 → 確認後 app 完整退出、shell 子程序全滅 (9.0s)
      ok 10 e2e\app-close.spec.ts:127:5 › 無跑中終端機按 X → 不彈窗、直接完整退出 (6.2s)
      ok 11 e2e\app-close.spec.ts:143:5 › 確認彈窗按取消 → 不關閉、終端機仍活；再按 X 確認後退出 (6.5s)
      -  12 e2e\codex-status-dogfood.spec.ts:11:5 › 真實 Codex 啟動停在輸入列顯示已停止，離開後回未啟動
      ok 13 e2e\delete-trash.spec.ts:7:5 › 檔案總管刪除 → 檔案從樹消失（回收桶）+ danger 按鈕為紅底 (6.7s)
      ok 14 e2e\diff-in-editor.spec.ts:11:5 › 點變更檔 → 編輯器區開 diff 分頁（含 Monaco diff） (8.7s)
      3 skipped
      11 passed (1.5m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=2/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok  5 e2e\editor-clipboard.spec.ts:92:5 › 貼上：右鍵選單 Paste 與 Ctrl+V 都貼進編輯器 (6.3s)
      ok  6 e2e\editor-conflict.spec.ts:26:5 › REQ-E2E-009：外部修改不再彈窗打斷；關檔時才提醒（不儲存） (7.2s)
      ok  7 e2e\editor-conflict.spec.ts:55:5 › REQ-E2E-009：關檔時選儲存 → 磁碟已被外部改 → 覆蓋存回我的編輯 (7.3s)
      ok  8 e2e\editor-external-refresh.spec.ts:7:5 › 外部變更即時對帳，右鍵關閉全部只處理目前工作區且尊重取消 (8.1s)
      ok  9 e2e\editor-reveal-on-open.spec.ts:10:5 › 編輯器隱藏時點檔案：自動顯示編輯器並開檔（含已開分頁再點） (6.2s)
      ok 10 e2e\editor-toggle-terminal.spec.ts:10:5 › 關閉編輯器：終端機原地存活、不重建、版面正常（問題3 迴歸） (6.2s)
      ok 11 e2e\editor-ws-tabs.spec.ts:7:5 › 切換工作區只見該工作區分頁；切回還原原分頁與內容 (6.0s)
      11 passed (1.4m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=3/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
    [branch-management] unfinished: 60386ms
      ok 10 e2e\git-branch-management.spec.ts:50:5 › 分支管理：本地／遠端分組與兩階段完整清理真鏈路 (4.2m)
      ok 11 e2e\git-branch-management.spec.ts:166:5 › 遠端多 endpoint 部分失敗後，重啟仍顯示待辦並可繼續收斂 (2.2m)
      ok 12 e2e\git-branch-management.spec.ts:260:5 › 遠端 tip 在風險確認後變動時拒絕舊租約且不刪新 commit (1.5m)
      ok 13 e2e\git-branch-management.spec.ts:286:5 › 刪除目前分支時先切換到使用者選定分支，再以同一流程清理 (1.2m)
      Slow test file: e2e\git-branch-management.spec.ts (9.0m)
      Consider running tests from slow files in parallel. See: https://playwright.dev/docs/test-parallel
      13 passed (10.0m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=4/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
    SCM metadata test: Electron ready
    SCM metadata test: workspace ready
    SCM metadata test: snapshot gated
    SCM metadata test: history ready
    SCM metadata test: branches ready
    SCM metadata test: worktrees ready
      ok 14 e2e\git-operation-errors.spec.ts:214:5 › SCM 初次狀態掃描未完成時可讀歷史、分支與 worktree (10.8s)
      14 passed (4.5m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=5/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
    Running 6 tests using 1 worker, shard 5 of 12
      ok 1 e2e\git-publish.spec.ts:36:5 › 沒 upstream 的新分支按 push → 自動 push -u 設 upstream（全真鏈路） (12.1s)
      ok 2 e2e\git-publish.spec.ts:75:5 › 無 remote → 同步列顯示「發佈」；名稱驗證；gh 缺席給安裝引導 (10.8s)
      ok 3 e2e\git-publish.spec.ts:116:5 › 發佈成功路徑：gh shim 收到完整參數、UI 顯示已發佈 URL (12.4s)
      ok 4 e2e\git.spec.ts:35:5 › REQ-E2E-003：編輯→變更出現→stage→commit→清空、ahead+1 (14.2s)
      ok 5 e2e\git.spec.ts:65:5 › 整合終端或外部 push 後 SCM 自動清除過期的未推送數字 (21.3s)
      ok 6 e2e\history-pagination.spec.ts:12:5 › 真 Electron 歷史初載 20 筆，使用者每次捲到底追加 10 筆並保留切頁位置 (27.7s)
      6 passed (1.7m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=6/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
        "workspaces": 10,
        "windowMs": 18000,
        "budget": 10
      }
    }
      ok 10 e2e\perf.spec.ts:156:5 › REQ-MON-006 N=10 背景閒置監控 CPU 低水位 (29.0s)
      ok 11 e2e\rail-resize.spec.ts:11:5 › 工作區欄可拖曳調寬 + 重啟持久化 (9.6s)
      11 passed (2.1m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=7/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok  7 e2e\search.spec.ts:45:5 › 檔名搜尋：命中列「檔案」群組點了開檔；內容命中點擊跳行並反白命中片段 (8.4s)
      ok  8 e2e\sheet-view.spec.ts:8:5 › xlsx 開啟為表格預覽（非亂碼），儲存格值正確 (6.3s)
      ok  9 e2e\shell.spec.ts:6:5 › 外殼渲染 + 主題即時切換 + 重啟沿用 (REQ-E2E-007) (11.4s)
      ok 10 e2e\splash.spec.ts:32:5 › 主視窗就緒前不顯示 Electron loading 視窗，renderer 握手後才顯示主畫面 (8.0s)
      ok 11 e2e\splash.spec.ts:60:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (7.4s)
      ok 12 e2e\splash.spec.ts:76:5 › 主畫面載入失敗時可從 splash 確實退出 (7.0s)
      ok 13 e2e\splash.spec.ts:85:5 › 初始化首次失敗後在同一程序重試成功 (7.3s)
      13 passed (2.3m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=8/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok 6 e2e\terminal-clipboard.spec.ts:100:5 › 同工作區兩個終端機：A 選取後 Ctrl+C 可複製到 B，無選取仍保留 SIGINT (10.3s)
      ok 7 e2e\terminal-clipboard.spec.ts:182:5 › OSC52 寫入：真 shell 發序列 → 系統剪貼簿更新（Claude Code 選取複製鏈路） (9.3s)
      ok 8 e2e\terminal-clipboard.spec.ts:213:5 › 右鍵貼上防抖：300ms 內第二次右鍵只貼一次；窗過後可再貼 (11.9s)
    [基準] buffer=normal mouseEventsActive=false
    [alt-screen] ?1049h 抵達 xterm：buffer=alternate
    [mouse] ?1003h/?1006h 抵達 xterm：mouseEventsActive=true
      ok 9 e2e\terminal-conpty-passthrough.spec.ts:80:5 › PTY 子程序送的 alt-screen／滑鼠追蹤序列必須真的抵達 xterm（ConPTY 不可吞掉） (12.1s)
      9 passed (1.8m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=9/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok  4 e2e\terminal-file-link.spec.ts:152:5 › 工作區外檔案：主程序確認後才外開，危險腳本一律封鎖 (6.1s)
      ok  5 e2e\terminal-fit-clip.spec.ts:39:5 › 終端機放大/小幅縮放後，最後一列不被裁切（畫布不溢出 host） (7.3s)
      ok  6 e2e\terminal-fit-clip.spec.ts:102:5 › 切主題時已開的終端機即時跟隨（dogfood 回報：切風格終端機不變） (9.3s)
      ok  7 e2e\terminal-fit-clip.spec.ts:132:5 › 終端機容器底色＝xterm 背景色（整數格剩餘空間不露出主題底色＝無留白框） (8.8s)
      ok  8 e2e\terminal-font.spec.ts:9:5 › 終端機字型：預設 Consolas 14 → 面板切 JetBrains Mono 即時套用並持久化；unicode11 生效 (6.5s)
      ok  9 e2e\terminal-header.spec.ts:11:5 › 面板 ✕ 隱藏（setVisible，不 dispose）+ 工具列再開即現 (6.7s)
      ok 10 e2e\terminal-keycap.spec.ts:35:5 › REQ-TERM-009：真 PTY 輸出 keycap 1️⃣ → buffer 退化成純數字、無 U+20E3 圍框 (8.8s)
      10 passed (1.4m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=10/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      }
    }
      ok  6 e2e\terminal-multi-workspace-perf.spec.ts:47:5 › 四工作區 AI 串流時 renderer 維持可互動且資源成本有上限 (19.8s)
      ok  7 e2e\terminal-path-regression.spec.ts:9:5 › System32 位於 PATH 最後且沒有尾分號時仍可建立 PowerShell (6.0s)
      ok  8 e2e\terminal-path-regression.spec.ts:34:5 › shell 不存在時顯示結構化錯誤，不再像按鈕沒有反應 (4.5s)
      ok  9 e2e\terminal-resize-heal.spec.ts:40:5 › PTY 尺寸漂移後持續輸出即自癒（不必重新點擊，ConPTY rows 回到 xterm rows） (10.5s)
      ok 10 e2e\terminal-rightclick-tui.spec.ts:26:5 › TUI 滑鼠模式下右鍵貼上：PTY 不收滑鼠回報、marker 恰寫入一次 (10.8s)
      10 passed (1.5m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=11/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      ok  4 e2e\terminal-web-link.spec.ts:8:5 › Ctrl+點擊終端機 HTTP 網址：由系統瀏覽器外開，一般點擊不觸發 (6.5s)
      ok  5 e2e\terminal.spec.ts:15:5 › REQ-E2E-008：跑中終端機 → 移除工作區彈關閉確認 → 確認後移除 (6.7s)
      ok  6 e2e\toggle-terminal.spec.ts:9:5 › toggle 終端機顯隱：setVisible 不 dispose、隱藏騰出空間、再開原地重現 (6.2s)
      ok  7 e2e\workspace-rail.spec.ts:10:5 › 工作區列可 toggle 顯隱 (4.8s)
      ok  8 e2e\workspace-rail.spec.ts:25:5 › 重設版面也還原工作區 rail 寬度 (4.8s)
      ok  9 e2e\workspace-switch-badge.spec.ts:9:5 › 點工作區列項的徽章格（非名字按鈕）也能切換工作區（整列可點） (5.2s)
      ok 10 e2e\workspace-switch-stale.spec.ts:10:5 › bug1：快速切換時前一工作區的慢 git 載入不覆蓋當前（取消 stale） (10.0s)
      10 passed (1.3m)
    ```
  - `cmd /c npm run e2e -- --workers=1 --shard=12/12 --grep-invert "REQ-PERF-001"`（exit 0）
    ```
      }
    }
      ok  6 e2e\worktree-perf.spec.ts:130:5 › REQ-PERF-006：建立 worktree p95 < 5s（UI 不凍結） (10.3s)
      ok  7 e2e\worktree.spec.ts:33:5 › REQ-E2E-012：分支→建立 worktree→納管開啟→終端機 cwd＝worktree→切回主 repo (10.8s)
      ok  8 e2e\worktree.spec.ts:74:5 › REQ-E2E-013：移除 worktree——dirty 兩段確認→連同刪除；僅移出保留資料夾 (1.5m)
      ok  9 e2e\worktree.spec.ts:173:5 › worktree 移除相容舊資料：一般工作區加入時兩種移除都有效 (1.5m)
      ok 10 e2e\worktree.spec.ts:222:5 › F-13：分支分頁「在新 worktree 開啟」建立；checkout 衝突→跳到該 worktree (15.3s)
      10 passed (4.2m)
    ```
  - 耗時：合計 3396s｜cmd /c npm run typecheck -- --pretty false 15s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6 410s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6 505s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6 72s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6 143s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6 63s｜cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6 57s｜cmd /c npm run build 74s｜cmd /c npm run e2e -- --workers=1 --shard=1/12 --grep-invert "REQ-PERF-001" 91s｜cmd /c npm run e2e -- --workers=1 --shard=2/12 --grep-invert "REQ-PERF-001" 85s｜cmd /c npm run e2e -- --workers=1 --shard=3/12 --grep-invert "REQ-PERF-001" 603s｜cmd /c npm run e2e -- --workers=1 --shard=4/12 --grep-invert "REQ-PERF-001" 276s｜cmd /c npm run e2e -- --workers=1 --shard=5/12 --grep-invert "REQ-PERF-001" 106s｜cmd /c npm run e2e -- --workers=1 --shard=6/12 --grep-invert "REQ-PERF-001" 128s｜cmd /c npm run e2e -- --workers=1 --shard=7/12 --grep-invert "REQ-PERF-001" 138s｜cmd /c npm run e2e -- --workers=1 --shard=8/12 --grep-invert "REQ-PERF-001" 114s｜cmd /c npm run e2e -- --workers=1 --shard=9/12 --grep-invert "REQ-PERF-001" 89s｜cmd /c npm run e2e -- --workers=1 --shard=10/12 --grep-invert "REQ-PERF-001" 91s｜cmd /c npm run e2e -- --workers=1 --shard=11/12 --grep-invert "REQ-PERF-001" 80s｜cmd /c npm run e2e -- --workers=1 --shard=12/12 --grep-invert "REQ-PERF-001" 253s
  - sig: ee8bc37f6d3110e2718b825ec4b236db6c7b53bc6703eb23c226a449b799c80a
