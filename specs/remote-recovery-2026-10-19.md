# 手機遠端暫停與恢復驗證

日期：2026-10-19。版本：v0.41.0。修正提交：`3227db5`。開發基底：`f66dfc6`。

## 修正行為

- 每 10 秒檢查 Tailscale。暫時失敗先拒絕全部手機 HTTP 請求與啟動，連續三次失敗才停止服務；完整檢查成功後解除暫停。
- Funnel、私人位址或代理設定改變、未知安全設定立即停止服務；停止後須電腦手動啟用。手動停用清除已失效的重試提示。
- 暫停取消未送命令的操作；以生命週期與連線 revision 拒絕舊驗證、慢速 HTTP body 及跨暫停的啟動，不在恢復後重播。
- 設定顯示原因及重試進度；既有 audit 保存暫停、恢復和停用原因，清理失敗追加說明並保留原原因。遮蔽未知 CLI 原始輸出，不更動資料版本、IPC 或環境變數契約。

## 通過結果

驗證由 `C:\polydesk-dev` junction 執行，已確認指向此 checkout。

| 指令／範圍 | 結果 |
| --- | --- |
| `npm run typecheck -- --pretty false` | 通過 |
| `npm test -- src/main/remote/RemoteService.test.ts src/main/remote/TailscaleGateway.test.ts --maxWorkers=1 --minWorkers=1` | 34／34 通過 |
| `npm test -- src/shared/releaseNotes.test.ts src/main/window/portableStartup.test.ts src/main/window/portableSplash.test.ts --maxWorkers=1 --minWorkers=1` | 7／7 通過 |
| `npm run build`；`npm run dist` 完整重建與 portable 封裝 | 通過 |
| `e2e/onboarding-help.spec.ts` | 4／4 通過 |
| `e2e/remote-launch.spec.ts` | 重跑 1／1 通過，原等待上限保留 |
| `e2e/remote-recovery.spec.ts` | 1／1 通過，真 execFile、HTTP 與 Electron；含重開後原因紀錄 |
| `git diff --check` | 通過 |

Electron 共六案為分批通過，未宣稱同一輪全量綠燈；本輪未跑完整 ship runner。舊版搭配新增暫停回歸會失敗，修後通過；手動停用提示也有先紅後綠證據。

## 首輪失敗與處理

- 手機啟動首輪已建立分頁，但 12 秒內未讀到測試命令輸出。補上失敗時安全診斷後，同案未改產品或等待上限即重跑通過；未取得足以斷言首次根因的證據。
- native CLI fixture 首輪啟用後未見預期 mapping。補啟用前斷言後，確認 Electron 主程序沒有採用啟動傳入的 ProgramFiles；第二輪在啟用前即拒絕繼續。不能將首輪算為隔離驗證，也不能聲稱該輪未接觸真 Tailscale。
- 後續唯讀確認沒有留下 8443、TCP Serve 或 Foreground 設定，使用者原遠端啟停紀錄未變。測試改為先驗證隔離 userData 與未打包狀態，再於該測試程序內設定 ProgramFiles，並核對 fixture URL 與命令紀錄。
- 真 gateway 啟用涉及多次子程序呼叫，原常數 gateway 的 12 秒 UI 斷言不足以代表啟用完成。測試改等操作按鈕恢復可用，再斷言結果，上限 90 秒、整案 240 秒；產品 CLI 的 10 秒逾時及監測行為未變。失敗會先保存安全 JSON 與畫面，再清理。

## 導覽、安全與交付界線

首次／手動七步導覽及目標 selector 不變，第六步手機入口仍通過；完整指南與設定同步原因、重試、停用和查閱紀錄步驟。手機 320／390 寬度的既有溢出檢查隨手機流程通過，桌面暫停畫面已目視檢查。

測試使用 native CLI fixture，不等同真 Tailscale 帳號與實體手機行動網路量測。portable 煙霧驗證不啟用遠端功能，避免依賴未經證實的 ProgramFiles 啟動覆寫；驗證版本、預設關閉、無 listener、renderer 隔離及正常退出清理解壓。

## Portable 交付

交付檔 `Polydesk-0.41.0-portable.exe`：96,185,170 bytes，SHA-256 `4656647AB75C9E42B928E3A8978DC42052B2F935105239BCAB4725B76DD88F79`；來源與交付副本的大小、雜湊一致。

實際 EXE 隔離啟動確認 v0.41.0、遠端預設關閉且無 loopback listener、renderer 無 Node API；QR 依賴與 native PTY 隨包。程式內正常關閉後 wrapper exit 0，自己的解壓目錄與測試暫存目錄均清理。煙霧測試未啟用遠端功能。

產物對應產品提交 `3227db5`；後續提交僅補發布文件，不改變已驗證的產品程式。
