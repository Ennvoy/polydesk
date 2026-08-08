# 移除 Claude／Codex 專用對話軸出貨報告

## 做了什麼

- 移除 Claude 與 Codex 的專用對話軸，兩種 AI 終端機統一使用既有通用內容導覽。
- 刪除 `ai:conversation` IPC 契約與 handler、Claude transcript reader、Codex rollout 對話 reader、session／scrollback 配對、renderer 背景輪詢及專用節點樣式。
- 終端機導覽不再讀取 AI 對話檔，只依目前 xterm buffer 的非空邏輯行建立節點。
- 保留 `POLYDESK_TERM_ID` 的 Claude hook 狀態清理用途，以及 AI 快捷啟動、PTY 尺寸同步與工作區狀態徽章。
- 版本同步至 v0.24.0，README、CHANGELOG、內建 release notes、tasks、MAP 與 HISTORY 均已更新。

## 驗了什麼

- TypeScript typecheck 與正式 build 通過。
- 目標回歸：50 個 main／PTY／monitor／terminal／安全 Vitest，以及 2 個真 Electron AI launch／內容導覽旅程全綠。
- 全量 Vitest 共 564 案：高併發初跑 563 案通過；唯一既有 `FileWatcher` 事件洪水案例單 worker 隔離重跑 7/7 綠，接著完整序列重跑 564/564 全綠。
- 全量 Electron E2E 共 109 案：106 通過，3 個需真 Agy／Codex 帳號的 dogfood 案例依既有條件跳過；四工作區串流與 worktree 效能門檻通過。

## 證據在哪

- 公開契約回歸：`tests/security/conversationAccess.test.ts`。
- Claude／Codex 使用通用內容導覽的真 Electron 回歸：`e2e/terminal-ai-launch.spec.ts`。
- 通用內容導覽行為：`src/renderer/components/Terminal/terminalNavigation.test.ts`、`e2e/terminal-navigation.spec.ts`。
- 版本與使用說明：`src/shared/releaseNotes.ts`、`README.md`、`CHANGELOG.md`。
