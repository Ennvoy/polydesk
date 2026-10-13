# 手機啟動 Claude bypass

## 需求與授權

來源為決議 121-133。使用者要求手機按一次，在自己的 Polydesk 新增真實 Claude bypass 終端機；同事亦能在各自安裝的 Polydesk 獨立設定。2026-10-12 使用者授權：「問題就依照你的建議，請直接做完到出貨交付為止」。後續工程與 UI 推薦依此授權定案，不表示使用者逐項或逐圖確認。

本輪包含配對、工作區授權、固定命令啟動及結果查詢；不包含遠端鍵盤、桌面解鎖、任意命令、遠端登入 Claude、共用主機多人帳號或公開服務。

## 使用流程

1. 手機與電腦安裝並登入 Tailscale，使用私人 HTTPS Serve 連線。
2. 電腦設定中的「手機遠端啟動」預設關閉，使用者明確啟用。每次重新啟動 Polydesk 需再次啟用，已批准配對及工作區授權保留。
3. 電腦逐一允許信任的工作區；新增工作區不自動允許，更換實際目標需重新授權。手機只取得已授權的名稱與識別碼。
4. QR 碼與手動碼共用兩分鐘的一次性挑戰；手機提出申請後，電腦核對雙端識別資訊，選擇配對期限：7 天（預設）、30 天、永久，再批准或拒絕。
5. 批准時間起算期限；永久指直到手動撤銷，瀏覽器清除資料後仍須重新配對。改期限先撤銷再重新配對。
6. 手機按指定工作區的 Claude bypass；電腦恢復 Polydesk 視窗、切換工作區、顯示新分頁。Windows 鎖定狀態保留。
7. 手機只回報「已建立分頁並送出啟動命令」。Claude 安裝、登入及後續錯誤在電腦終端機確認。
8. 離線直接回報；不排隊、不自動重送。已送請求但未取得結果時，查詢原操作識別碼；查無或重啟後無法確認則先檢查桌面，再決定另一次手動啟動。

## 安全與生命週期

- HTTP 僅監聽 loopback；私人 HTTPS 由 Tailscale Serve 提供，不使用 Funnel，也不放寬至公開或 LAN listener。
- 私網連線與 Polydesk 配對各自檢查。代理身分標頭不取代配對認證。
- 瀏覽器憑證使用 Secure、HttpOnly、SameSite cookie；本機只保存隨機憑證雜湊。遠端憑證及授權不參與一般設定匯出與匯入。
- 固定白名單 IPC、Host／Origin／CSRF／JSON 檢查、輸入及請求容量限制；配對碼不出現在伺服器 URL query、日誌或第三方 QR 服務。
- 建立終端機前與送命令前重驗配對、功能開關、工作區及實際路徑；撤銷取消尚未送出的命令，不終止已啟動 Claude。
- 接受的啟動能力只有工作區 ID 與操作 ID，不接受 shell、cwd、command 或終端輸入。
- 操作 ID 綁定配對與目標，重送不新增分頁；結果留存 7 天，最多 1000 筆，容量滿時拒絕新請求。
- 重啟未完成請求標記結果未知，不恢復執行；網路／代理驗證失敗停止受理。限速與競爭處理防止大量建立程序。
- bypass 沿用既有權限略過模式，工作區授權不是 Claude 的檔案系統沙箱。

## 驗收與證據

| 範圍 | 實測方式 |
|---|---|
| 未配對、過期、撤銷、錯誤 Host／Origin／CSRF、Funnel、payload 與限速 | 真實 loopback HTTP 的單元／整合測試；獨立安全審查重現 |
| QR／備用碼、批准／拒絕、期限、零授權清單 | Electron 設定頁與手機瀏覽器實走 30 天批准；7 天／永久及批准起算由真 HTTP／持久檔測試確認，截圖及 overflow 檢查另留存 |
| 真實新分頁、固定命令、尺寸就緒、隱藏面板與最小化 | 真 Electron、真 IPC、真 PTY；測試 CLI 接住參數，避免登入或模型額度影響 |
| 重送、不同目標、多瀏覽器競爭、重啟與結果未知 | 同 ID 重複 HTTP、持久檔重新載入及 renderer ready 前撤銷 |
| 手機離線／恢復／查無紀錄 | 補充真 Electron／PTY／Chrome／HTTP 走查：斷線阻止啟動、恢復只查原操作、未知結果需先查看桌面；送出次數與分頁數均維持一次 |
| 教學／指南與既有功能 | 導覽、使用說明、終端機及工作區回歸，加全量 ship runner |
| 打包 | portable 啟動煙霧測試、版本、檔案大小及交付副本 SHA-256 |

真 Tailscale 帳號登入與手機行動網路需使用者自己的裝置及帳號；測試 gateway 的結果必須與實際 Tailscale／手機實測清楚區分，不宣稱未跑的外部鏈路已驗證。

## 官方依據

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [反向代理原始碼](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go)
- [Claude 權限模式](https://code.claude.com/docs/en/permission-modes)
