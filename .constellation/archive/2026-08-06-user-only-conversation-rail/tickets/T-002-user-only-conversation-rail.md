# T-002 使用者提問對話軸
status: done
blocked-by:
zone: src/shared/channels.ts, src/shared/ipc.ts, src/shared/types.ts, src/shared/releaseNotes.ts, src/main/pty/PtyManager.ts, src/main/pty/PtyManager.test.ts, src/main/claude/**, src/main/monitor/ClaudeStatusMonitor.ts, src/main/monitor/ClaudeStatusMonitor.test.ts, src/main/monitor/aiProcessScan.ts, src/main/monitor/aiProcessScan.test.ts, src/main/monitor/codexConversation.ts, src/main/monitor/codexConversation.test.ts, src/main/ipc/router.ts, src/renderer/components/Terminal/TerminalPanel.tsx, src/renderer/components/Terminal/TerminalView.tsx, src/renderer/components/Terminal/terminalConversation.ts, src/renderer/components/Terminal/terminalConversation.test.ts, e2e/terminal-transcript-rail.spec.ts, e2e/terminal-navigation.spec.ts, e2e/terminal-ai-launch.spec.ts, README.md, CHANGELOG.md, package.json, package-lock.json

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

Claude 與 Codex 的終端機對話軸只列出目前終端機 session 中的使用者文字，快捷與手動啟動行為一致；Claude 節點開啟對應 transcript 回合，Codex 節點捲到目前 scrollback 中能可靠配對的原始提問行。

## 驗收條件（合成階段寫定，逐條可勾）
- [x] Claude 對話同時含使用者與模型訊息時，畫面只產生使用者節點，點擊仍能定位對應回合。
- [x] Codex TUI rollout 同時含 injected context、使用者訊息及模型訊息時，只採互動式 TUI 的使用者文字；能唯一對應目前 scrollback 的節點可點擊捲動，歧義或已離開 buffer 的節點不顯示。
- [x] 從快捷按鈕或在一般終端機手動啟動 Claude／Codex，都能在辨識 session 後使用相同對話軸；一般 PowerShell 或無可靠 session 綁定時不會誤顯示其他 AI 對話。
- [x] 多個同工作區終端機不會互相讀取 Claude／Codex 對話，程序結束、session 換檔或資料讀取失敗時不保留過期節點。
- [x] 型別檢查、相關單元／整合測試及真 Electron 對話軸旅程通過。

## 決議記錄（實作期小事自決落此，可追溯）

- Codex 本版只採 `source=cli`、`originator=codex-tui` 的 `event_msg/user_message`，不以可能含注入上下文的 response user 訊息作預設來源。
- AI session 無法唯一綁定到目前 terminal 時採 fail-closed：不顯示 AI 節點，不回退把模型輸出當一般行節點。
- 視覺定稿沿用決議 011；凍結樣式檔不納入實作 zone。
- 出貨時補入內建 release notes 與實際 E2E 檔名，確保 v0.22.0 版本單一真相及真 Electron 驗收被 ticket zone 涵蓋。
- Codex cwd 只用來找候選；必須恰好一個 TUI session 的文字能命中本 terminal 帶 `›／❯` 的 prompt 行才綁定，多候選命中一律 fail-closed。
- Standards 與 Spec 兩軸審查曾提出 session 誤綁、輪詢成本、節點上限與主鏈路證據；修正後由原審查者各自複核，最終皆無 blocker。

## 驗證指令（可選；票級縮圈清單，weave 寫定——省略則 runner 跑 config 全量）
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npx vitest run src/main/pty src/main/claude src/main/monitor src/renderer/components/Terminal --maxWorkers=1 --minWorkers=1`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-08-06T06:49:08.807Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    
    > polydesk@0.22.0 typecheck
    > tsc --noEmit --pretty false
    
    
    ```
  - `cmd /c npx vitest run src/main/pty src/main/claude src/main/monitor src/renderer/components/Terminal --maxWorkers=1 --minWorkers=1`（exit 0）
    ```
     [32m✓[39m src/main/monitor/claudeHookState.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalNavigation.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/ptyDataDispatcher.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/secureOptions.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/clipboardKeys.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/displayNormalize.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalConversation.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/monitor/aiProcessScan.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m19 passed[39m[22m[90m (19)[39m
    [2m      Tests [22m [1m[32m148 passed[39m[22m[90m (148)[39m
    [2m   Start at [22m 14:48:40
    [2m   Duration [22m 28.06s[2m (transform 678ms, setup 0ms, collect 2.44s, tests 14.10s, environment 3ms, prepare 3.76s)[22m
    
    
    ```
  - sig: dffa5cbb22c3b4a0032a1e2bc5d21d7179ffa5961e4f3e08143dade0ef8ed221
- **2026-08-06T07:59:16.898Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    
    > polydesk@0.22.0 typecheck
    > tsc --noEmit --pretty false
    
    
    ```
  - `cmd /c npx vitest run src/main/pty src/main/claude src/main/monitor src/renderer/components/Terminal --maxWorkers=1 --minWorkers=1`（exit 0）
    ```
     [32m✓[39m src/renderer/components/Terminal/terminalWebLinks.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalNavigation.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/terminalConversation.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/monitor/aiProcessScan.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/main/monitor/claudeHookState.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 3[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/secureOptions.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/ptyDataDispatcher.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/renderer/components/Terminal/clipboardKeys.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 2[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m19 passed[39m[22m[90m (19)[39m
    [2m      Tests [22m [1m[32m154 passed[39m[22m[90m (154)[39m
    [2m   Start at [22m 15:58:53
    [2m   Duration [22m 23.14s[2m (transform 585ms, setup 0ms, collect 2.15s, tests 11.94s, environment 2ms, prepare 2.62s)[22m
    
    
    ```
  - sig: ca9ca6ef2ab8b45ecf1e4aceae55978d15dcf503c53de026b62bd18b440adeb5
