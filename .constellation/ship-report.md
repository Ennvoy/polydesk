# 完整移除終端機導覽軸出貨報告

## 做了什麼

- 完整移除所有終端機的內容／對話導覽軸，不再依 Claude、Codex、Agy 或一般 shell 分流。
- `TerminalView` 刪除 buffer 掃描、節點狀態、更新訂閱、點擊與 Alt 鍵跳轉；刪除導覽純函式、單測、專用 E2E 與 CSS。
- xterm host 收回固定預留的 18 px 左側空間；PTY、scrollback、快捷啟動、尺寸同步與工作區 AI 狀態維持不變。
- 版本同步至 v0.26.0，README、CHANGELOG、內建 release notes、tasks、MAP 與 HISTORY 均已更新。

## 驗了什麼

- 修正前真 Electron 回歸在 Claude 終端找到 1 個 `.pd-term-navigation`。
- TypeScript typecheck、正式 build 與 Claude bypass／Codex／Agy 快捷啟動目標 E2E 已通過；三種終端正常啟動且整頁導覽元素為 0。
- 完整序列 Vitest 通過：65 個測試檔、562/562 案全綠；比 v0.25.0 少的 3 案精確對應被刪除的導覽純函式測試。
- 真 Electron E2E 共 108 案：105 通過、3 個真 AI dogfood 依既有條件跳過；第 8 shard 初跑有一次檔案連結 Ctrl+點擊時序 flake，隔離單案與完整 shard 重跑皆綠。
- `REQ-PERF-001` 沿用既有核准豁免；四工作區串流 frame p95 16.9 ms、renderer CPU 1.4%。worktree list p50 232 ms 通過既有 regression guard；報表 p95 461 ms（N=3）高於文字 budget 300 ms，但現行斷言只守 p50，本輪未修改無關契約。

## 證據在哪

- 功能提交：`b18241e`。
- 完整移除：`src/renderer/components/Terminal/TerminalView.tsx`、`src/renderer/components/Terminal/terminal.css`。
- 被刪除的支援鏈：`src/renderer/components/Terminal/terminalNavigation.ts`、`terminalNavigation.test.ts`、`e2e/terminal-navigation.spec.ts`。
- 真 Electron 回歸：`e2e/terminal-ai-launch.spec.ts`。
- 版本與使用說明：`src/shared/releaseNotes.ts`、`README.md`、`CHANGELOG.md`。
