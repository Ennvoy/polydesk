# Polydesk portable 啟動畫面立即顯示出貨報告

## 做了什麼

- Windows portable 封裝新增 420×230、24-bit RGB 的 Polydesk BMP，讓 electron-builder 啟動器在自解壓期間先提供可見回饋。
- Electron splash 移除 250 ms timer，原生 BrowserWindow 建立後立即顯示深色背景，再載入品牌內容；主初始化等原生 `show` 事件後才開始。
- 兩層 splash 皆無最低停留時間；主視窗仍須同時通過 `ready-to-show` 與 renderer-ready 握手，安全設定、失敗重試／退出與第二實例行為不變。
- 公開文件明確界定：portable 啟動器會在啟動 Electron 前銷毀 splash，Windows 驗簽／防毒與兩程序交界不保證零延遲。首次導覽與完整使用指南內容經檢查不受影響。

## 驗了什麼

- 票級 runner 5/5 指令通過：typecheck、release notes 3/3、portable BMP 1/1、正式 build 與 splash 真 Electron 3/3。
- 最終 ship runner 20/20 指令通過：67 個 Vitest 檔、572/572 案全綠，正式 build 通過；12 個單 worker Electron E2E shard 共 112 通過、3 個需真 AI 帳號的 dogfood 依條件跳過。
- `REQ-PERF-001` 依既有核准豁免精確分離，未放寬產品 budget 或斷言。首輪 ship runner 的 F-13 worktree 案曾有一次按鈕等待時序 flake，其後單案 1/1 與完整 runner 最後分片皆通過。
- 實際啟動 v0.28.0 portable 後，從原生 HWND 擷取到 420×230 完整品牌 splash；暖啟動約 825 ms 顯示。Spec 與 Standards 兩條獨立複核最終皆為 0 blocker、0 suggestion。

## 證據在哪

- 功能提交：`b8eb542`。
- 最終 runner 證據：`.constellation/archive/2026-08-11-portable-startup-splash/ship-evidence.md`，簽章 `f7b19b85100c19c25349d865b686865757028c9f2cbca7e3ca57bdc6392dc4cb`。
- 需求與票據：同一 archive 下的 `tickets/` 與 `grill-close.md`；關鍵決策為 `.constellation/decisions/039-splash-shows-immediately.md` 與 `040-portable-extraction-splash.md`。
- 核心實作：`package.json`、`build/portable-splash.bmp`、`src/main/index.ts`、`src/main/window/splashWindow.ts`、`src/main/window/portableSplash.test.ts` 與 `e2e/splash.spec.ts`。
- 版本與使用文件：`src/shared/releaseNotes.ts`、`README.md`、`CHANGELOG.md`、`specs/tasks.md`、`.constellation/MAP.md` 與 `.constellation/HISTORY.md`。
