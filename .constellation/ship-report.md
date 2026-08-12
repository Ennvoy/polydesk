# Polydesk portable 單一動畫啟動畫面出貨報告

## 做了什麼

- 移除 electron-builder `portable.splashImage` 與 420×230 BMP，portable 自解壓階段不再建立無法轉動的靜態視窗。
- 自解壓完成後只保留既有 Electron 動畫 splash；主視窗仍須同時通過 `ready-to-show` 與 renderer-ready 握手，安全設定、失敗重試／退出與第二實例行為不變。
- 明確接受單一 EXE 自解壓期間短暫沒有畫面的取捨，換取使用者只看到一次、且真正會轉動的啟動畫面。
- 出貨驗證另外修正 SCM checkout／工作區切換分頁 race，並讓真 Git、Windows clipboard 與 worktree 效能 E2E 保留真實產品鏈路但排除測試自身競爭。首次導覽與完整使用指南經檢查不受影響。

## 驗了什麼

- 最終 ship runner 20/20 指令通過，總耗時 2,340 秒：67 個 Vitest 檔、572/572 案全綠，正式 build 通過；12 個單 worker Electron E2E shard 共 112 通過、3 個需真 AI 帳號的 dogfood 依條件跳過。
- splash 真 Electron 3/3、Git shard 4 11/11、editor clipboard 與 terminal clipboard 全鏈均在最終完整輪次通過；`REQ-PERF-001` 依既有核准豁免分離。
- 最終 worktree list p50 294 ms、p95 312 ms（n=3）；p95 略高於 300 ms 產品 budget，只能確認未觸發既有 1,500 ms regression ceiling。worktree create p50／p95 3,226 ms（n=1），低於 5 秒 budget。
- Windows clipboard service 曾長時間拒絕 PowerShell 與 Electron 存取；確認專用 svchost 未承載其他服務後重建，Copy／Paste 壓測 6/6、完整 shard 與最終 runner 均通過。

## 證據在哪

- 功能提交：`b0523ff`。
- 最終 runner 證據：`.constellation/archive/2026-08-12-portable-single-animated-splash/ship-evidence.md`，簽章 `20d8a5cc5b48993627e83693a927936155b20c7c584f15761f41daac42b4a408`。
- 關鍵決策：`.constellation/decisions/041-single-animated-splash.md`，取代 `040-portable-extraction-splash.md` 的雙層 splash 決策。
- 核心實作：`package.json`、刪除的 `build/portable-splash.bmp`、`src/main/window/portableSplash.test.ts` 與既有 `src/main/window/splashWindow.ts`；SCM race 修正位於 `SourceControlPanel.tsx`。
- 版本與使用文件：`src/shared/releaseNotes.ts`、`README.md`、`CHANGELOG.md`、`specs/tasks.md`、`.constellation/MAP.md` 與 `.constellation/HISTORY.md`。
