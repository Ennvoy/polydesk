# Claude／Codex 使用者提問對話軸出貨報告

## 做了什麼

- 完成 1 張「使用者提問對話軸」票：Claude 與 Codex 的左側軸只顯示使用者文字，模型回覆不再產生刻度。
- Claude 以 PTY 注入的 `termId` 綁定 hook session，快捷與手動啟動共用同一條路徑；Codex 只讀互動式 TUI 的乾淨 `user_message`，並以本 terminal 的 prompt 行唯一反證候選 session。
- Claude 節點維持 transcript 回合定位；Codex 只建立能與目前 xterm scrollback 唯一配對的節點，程序掃描失敗、多候選命中或無可靠綁定時保守顯示空軸。
- 版本同步至 v0.22.0，README、CHANGELOG 與內建版本重點均已更新。

## 驗了什麼

- 全量 ship gate：TypeScript typecheck、正式 build、591 個 Vitest、109 個非豁免 Electron E2E 全綠；3 個真 AI dogfood 案例正常跳過，`REQ-PERF-001` 依既有核准豁免排除。
- 功能縮圈：154 個 main／PTY／monitor／terminal Vitest 與 6 個真 Electron 旅程全綠；新增未替換正式 handler 的 Codex process→rollout→IPC→xterm 主鏈路。
- Standards 與 Spec 兩軸獨立審查的阻擋候選均已修正並複驗；兩軸最終結果皆為無 blocker。

## 證據在哪

- 全量 runner 簽章證據：`.constellation/ship-evidence.md`。
- 驗收票、票級指令與簽章：`.constellation/tickets/T-002-user-only-conversation-rail.md`。
- 需求與設計決議：`.constellation/decisions/006-user-only-conversation-rail.md` 至 `009-split-feature-releases.md`，以及 `011-conversation-rail-design-final.md`。
- 功能回歸：`src/main/claude/sessionTranscript.test.ts`、`src/main/monitor/codexConversation.test.ts`、`src/renderer/components/Terminal/terminalConversation.test.ts`、`e2e/terminal-transcript-rail.spec.ts`。
