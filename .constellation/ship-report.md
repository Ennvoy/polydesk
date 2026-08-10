# 工作區標頭、首次導覽與啟動畫面出貨報告

## 做了什麼

- 移除最左側固定活動列，把檔案總管、搜尋、原始碼控制與設定集中到工作區標頭；保留 SCM 即時角標、active、tooltip 與無障礙狀態。
- 新增只在第一次啟動自動出現的 7 步導覽，支援完成、略過、中斷續接、版本失效與手動重開；導覽只還原自己暫時顯示且未被使用者覆寫的版面。
- 新增可搜尋的完整使用指南，並補齊總覽／AI 用量與 AI 產生 commit 訊息；「說明」選單與設定都能重開導覽或指南。
- 新增延遲 250 ms 顯示的安全 splash；主窗等待工作區載入、native `ready-to-show` 與固定白名單 renderer-ready 握手後才交接，失敗可重試／退出，第二實例不會提前顯示未就緒主窗。
- 持久化 schema 升至 v3，版本同步至 v0.27.0；README、CHANGELOG、內建 release notes、AGENTS／CLAUDE 維護規則、MAP 與 HISTORY 一併更新。

## 驗了什麼

- 票級 typecheck、正式 build、StateStore 28 案、工作區／SCM 2 案、啟動畫面 3 案與 onboarding/help 4 案全綠；出貨審查修正後 splash＋shell 4/4 與 renderer security baseline 8/8 通過。
- 最終 ship runner 共 66 個 Vitest 檔、571/571 案全綠；正式 build 通過。
- 12 個單 worker E2E shard 全綠：112 通過、3 個真 Agy／Codex dogfood 依既有條件跳過；`REQ-PERF-001` 依歷史核准豁免精確分離，其他功能與效能案例未排除。
- 未排除的完整 E2E 另行實跑 116 案：112 通過、3 跳過，唯一失敗是 `REQ-PERF-001`；cold-start p95 3,896 ms，高於原 3,000 ms 門檻。產品 budget 與斷言未放寬。
- 其餘效能案例通過：四工作區串流 frame p95 16.9 ms、renderer CPU 1.2%、working set 181.2 MB；worktree list p95 223 ms、建立 1,158 ms。
- Spec 與 Standards 兩條獨立複核最終皆為 0 blocker、0 suggestion；HelpCenter 的使用者同意解凍、修正、目標驗證與重新凍結鏈完整。

## 證據在哪

- 功能提交：`ad93a35`。
- 最終 runner 證據：`.constellation/archive/2026-08-10-workspace-header-onboarding-help-splash/ship-evidence.md`，簽章 `890184bf0336cce155524fbbd2a1525af9dc69a63036be45d995576567a27bc6`。
- 需求與票據：同一 archive 下的 `tickets/`、`grill-close.md` 與 `design-frozen.json`；關鍵決策為 `.constellation/decisions/012`–`038`。
- 核心實作：`src/main/index.ts`、`src/main/window/splashWindow.ts`、`src/renderer/components/WorkspaceRail.tsx`、`src/renderer/components/ActivityBar.tsx`、`src/renderer/components/Help/`、`src/main/store/` 與 `src/shared/`。
- 真 Electron 回歸：`e2e/splash.spec.ts`、`e2e/onboarding-help.spec.ts`、`e2e/shell.spec.ts`、`e2e/activitybar-scm-badge.spec.ts`。
- 版本與使用文件：`src/shared/releaseNotes.ts`、`README.md`、`CHANGELOG.md`、`AGENTS.md`、`CLAUDE.md`。
