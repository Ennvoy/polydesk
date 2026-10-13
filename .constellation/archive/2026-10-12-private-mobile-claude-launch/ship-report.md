## 做了什麼

T-010、T-011（done）：完成 v0.40.0 私人手機啟動 Claude bypass，並修正出貨驗證重現的 SCM 清理進度阻塞與閒置 AI 監控耗用。

- 電腦明確啟用後，以 Tailscale 私人 HTTPS 提供手機入口；兩分鐘一次性 QR／手動碼配對，電腦核對識別碼後批准，逐瀏覽器選 7 天、30 天或永久。每位同事使用自己的 Polydesk，逐一授權工作區，可撤銷手機。
- 手機按一次建立真 PTY／Claude 分頁；尺寸 ready 與授權重驗後，由 main 送出固定 `claude --dangerously-skip-permissions`。切換工作區、顯示終端機、還原最小化視窗，不解鎖 Windows。成功表示命令已送出，CLI 缺失、登入與實際就緒仍由桌面確認。
- 遠端功能每次開啟 Poly 預設關閉；只聽 loopback，拒絕 Funnel、未知或衝突設定。配對秘密只存雜湊，不隨 portable 或一般設定分享。離線不排隊、不重送；持久 opId 結果保留七天／一千筆，未知結果須先查桌面。
- 首次七步導覽的第六步、完整使用指南、README、CHANGELOG 與關於版本摘要同步。SCM 清理改為上一筆進度查詢結束後才排下一筆，隔離舊工作區／操作結果，保留最後真狀態與原安全佇列。終端機網址 E2E 改由真 buffer／viewport 定位並重新觸發真 hover。
- 全部工作區沒有 PTY 時，AI 狀態直接轉閒置並略過全域紀錄與程序掃描；單輪復用工作區清單，非同步回包仍重查當下 PTY，保留開啟終端機後的正常監控。

- 正式 portable 初版三次退出都留下本次解壓主程式；封裝清理改為有界重試、耗盡回報失敗，保留未知程序狀態不刪除的保護。

## 驗了什麼

- 正式 `verify-runner.mjs --scope ship` 從頭執行 20 個設定命令，全部 exit 0；時間 2026-10-12T14:51:15.167Z、合計 3396 秒。型別檢查、六組 Vitest、正式 build 與十二組 Electron E2E 均完成，簽章證據 ee8bc37f6d3110e2718b825ec4b236db6c7b53bc6703eb23c226a449b799c80a。
- Vitest：88 個檔案、723 項通過；Electron：128 項通過、3 項條件略過。既有 `REQ-PERF-001` 冷啟動測量豁免保留，未放寬 3 秒門檻；條件略過與外部鏈路不計入已通過項目。
- T-010 票級證據為 typecheck 與 69 項單元／整合測試；T-011 為 typecheck、build 與 14 項真 Electron 旅程。期限證據分工是 30 天 GUI、7／30／永久真 HTTP。其後另外補上五項真 Chrome／Electron 離線與未知結果走查，不能倒算成原 14 項：實際啟動一次、查原 opId、不重送、不新增分頁、確認已查桌面後只恢復可操作。
- SCM 新回歸先在舊 interval 行為得到 3 failed／4 passed，修後與回饋、版本測試共 13 passed；原完整分支案例 1 passed／6.2m，遠端段包含真 ref 刪除、原 120 秒刷新可用斷言及實際刷新。網址點擊連續三次通過，仍為真 hover 5 秒、一次 write／Ctrl click，普通點擊與白名單斷言不變。
- 閒置 CPU 原案單跑 10.244% 重現失敗；新增六項回歸在舊版為 3 failed／12 passed，修後監控相關五檔 42 passed，typecheck／build 通過。原 10 工作區、18 秒、10% 門檻修後 1 passed，CPU 0.8%；未加等待或修改效能案例。

| 已結案問題 | 修正及具體證據 |
| --- | --- |
| 先建立代理才佔本機埠，啟用失敗留入口 | 先保留 loopback 埠；真衝突與失敗清理回歸，Standards 複驗 |
| Funnel 漂移阻止清理自己的 Serve | 核對自己的精確端點，off 成功才清 ownership，失敗可重試，replacement 不覆寫 |
| 同 tick 啟用／停用掛住 | listen 取消也收斂；真來源 loopback 與同 tick 回歸 |
| 已申請操作沿用重授權後的新路徑 | 綁定原 realpath，ready 送命令前比較；紅軍原 path regrant 重現修後零寫入 |
| 前景 Funnel 未拒絕 | 有界遞迴檢查 Foreground；紅軍原 fixture 與 gateway 回歸 |
| 新操作排在慢 verification 後執行 | 即時拒絕新的並發，舊 opId 查既存結果；generation 阻止停用重啟後舊 verification 建立 PTY；兩項真 HTTP 回歸。此修正是移除 launch backlog，不是只調一千筆結果容量 |
| 分支整案時限小於既有逐步等待總和 | overall 1500 秒含 1320 秒既有等待及 setup／teardown；40 斷言與單步時限保留，原案實跑通過 |
| 清理成功後 status 查詢積壓，按鈕長時間 busy | 真 GUI／Git 診斷 205 請求、觀測 138 待處理，execute 已 closed 後最後查詢仍等 68.384 秒；single-flight 修正、先紅回歸及原 GUI 案通過 |
| 網址測試假設游標／畫面行與 hover 不變 | 真 buffer 換算中文／emoji 七格，讀實際 viewport 與尺寸，每輪真滑鼠移出再移入；三次原鏈路通過 |
| 完全沒有 PTY 仍反覆讀全域 AI 紀錄，閒置 CPU 超標 | 原案單跑重現 10.244%；診斷窗讀 Claude 1383 次、Codex open 187 次與 JSON parse 2228 次；全無 PTY 早退、單輪復用工作區，先紅回歸與修後原案 0.8% 通過。profiler 有額外成本，26.1278% 僅用於定位，未當效能驗收值 |
| portable 正常退出留下本次解壓主程式，單次刪除失敗仍 exit 0 | 有界重試及耗盡 exit 1；真 NSIS 短鎖、長鎖與 R6 保留三案通過；重建 EXE 兩次程式內關閉及一次 Windows 關閉均 exit 0、目錄消失，Standards 結案 |

- 手機功能與原十項問題的 Standards、Spec、安全紅軍無未結案 finding；新增封裝清理經真 NSIS 三情境與新版 EXE 三次正常退出驗證結案；盲點審補上配對挑戰、realpath／撤銷、送出與就緒區分、持久未知結果四項工程預設，均已落實於規格與驗證。下輪：無。
- 導覽／指南已一起驗證入口、配對、期限、授權、錯誤及風險。SCM 修正不改入口、兩階段確認、安全選項、卡片文案或 selector；AI 監控修正不改徽章狀態與操作，現有指南保持適用，兩項核對結論記於修正附件。
- 證據界限：未使用真 Tailscale 帳號或實體手機 4G，未宣稱該外部鏈路已驗證。測試 gateway 只在未打包 E2E 啟用。2026-10-13 交付 portable，對應產品提交 `42571ba`；96,183,549 bytes，SHA-256 `1C84D82F9A4508164EBAE1D19E49B90E0A6AE8EBBF370904FD1471423B56D88F`。來源與交付副本的大小、雜湊一致。實際 EXE 隔離啟動確認 v0.40.0、遠端預設關閉、renderer 無 Node API、忽略 E2E gateway；缺少 Tailscale 時顯示原因、停用且無 loopback 監聽。QR 依賴與 native PTY 隨包，正常退出後自己的解壓目錄已清理。
- 2026-10-12 唯讀核對 [Tailscale 官方代理原始碼](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go)：HTTP 代理保留原 Host，TLS 請求設置 HTTPS 轉送標頭，Funnel 設置專用識別標頭。這支持標頭契約，仍不代替實際帳號與手機網路量測。

## 證據在哪

- [交付 manifest](qa/remote-launch/artifact-manifest.json)、[真 portable 隔離啟動](qa/remote-launch/portable-smoke-v040.json)、[畫面](qa/remote-launch/portable-remote-default-off.png)。交付檔位於本機 `Documents/polydesk-dist/Polydesk-0.40.0-portable.exe`；文件補記不改產品程式，EXE 對應上述產品提交。

- [portable 清理修正與證據界限](qa/remote-launch/portable-cleanup-fix.md)、同目錄三次初版失敗 JSON 與真 NSIS 紅綠 JSON；正式全量簽章先於這次封裝修正。

- [正式出貨簽章證據](ship-evidence.md)、[正式 runner 結果](qa/remote-launch/final-ship-runner-result.json)及[本輪完成摘要](qa/remote-launch/final-ship-runner-summary.txt)；完成摘要不是所有測試的完整 stdout。
- [T-010](tickets/T-010-private-remote-launch.md)、[T-011](tickets/T-011-remote-launch-journey.md)、[覆蓋表](coverage.md)、[合成覆蓋表](weave-coverage.md)。
- [Standards](reviews/standards-review.md)、[Spec](reviews/spec-review.md)、[安全紅軍](reviews/security-redteam.md) 及同目錄原始重現 fixture。
- [SCM 根因與修正](qa/remote-launch/cleanup-polling-fix.md)、舊真 GUI 診斷、先紅回歸、修後原分支整案及三次網址點擊 raw／JSON。
- [閒置 CPU 根因與修正](qa/remote-launch/idle-cpu-diagnosis.md)、原案失敗、profile、先紅回歸與修後原門檻實跑；有 PTY 的耗用未在此閒置案例宣稱通過。
- [離線／未知結果走查](qa/remote-launch/offline-unknown-walkthrough.txt)、同目錄重現腳本及三張狀態 PNG；桌面撤銷與 320／390px 手機圖也在同目錄。含一次性 QR 的桌面配對原圖只留本機，保存位置與 SHA-256 見 [畫面證據保存](qa/remote-launch/screenshot-hygiene.md)。
- [工程預設](engineering-defaults.md)、[介面定稿](design-freeze.md)、[訪談收斂](grill-close.md)；決議 121–133 留在專案 `.constellation/decisions/`。
