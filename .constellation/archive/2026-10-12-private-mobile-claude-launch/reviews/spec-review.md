# 手機遠端啟動 Spec 整體檢查

日期：2026-10-12。狀態：Spec 審查定稿，未發現具體產品規格缺陷。

以決議 121–133 證據原話、工程預設、完整規格及本輪 UI 定稿為分母，未發現具體產品規格偏離。授權「問題就依照你的建議，請直接做完到出貨交付為止」支持推薦定案；文件沒有冒稱使用者逐題或逐圖確認。已核真 GUI 分頁、授權生命週期、固定能力、不排隊／結果查詢、前景恢復、預設關閉及雙層教學；原始 target 記錄支持 49 單元、6 GUI 與後續21遠端／1 GUI 通過。新核心以即時拒絕取代啟動佇列，停用重啟不復活舊請求。正式 ship／portable 由根代理續驗，屬交付程序；真 Tailscale／4G 未測為環境界限，均未冒稱通過。

## 附件：逐款來源對照

表中「符合」是程式與指定來源吻合；測試程式存在、工具實跑結果、人工看圖分開記載，並不互相代替。未讀其他 review 結論；票僅為索引，不作驗收分母。

| 來源及原意 | 實際 code／畫面 | 測試／限制 | 判定 |
|---|---|---|---|
| 121：「就像我按了claude bypass按鈕一樣」；真 Claude 分頁 | `shared/remoteLaunch.ts:3` 的固定命令同供本地按鈕及服務；`TerminalPanel.tsx:98` 接事件新增帶名稱的 GUI 項目，尺寸就緒後 `remote:ready` | `remote-launch.spec.ts` 檢查真 Electron `.pd-term-pane-label`、真 PTY CLI 參數、重送仍一個分頁；CLI fixture 不冒充真 Claude 登入 | 符合 |
| 122：在外用行動網路，電腦及 Poly 運作 | `TailscaleGateway` 私人 HTTPS；設定／手機頁說明保持開啟 | HTTP/Electron seam 不能證明行動網路端到端；本機未安裝 Tailscale 且無個人帳號 | 實作符合；外部鏈路未驗 |
| 123：各工作區旁一個 Claude bypass 按鈕，按哪個開哪個；兼顧安全 | `mobilePage.ts:16` 每列 name/id 和具名按鈕；只提交 wsId/opId；bypass 風險提示 | 真 E2E 從另一工作區、隱藏終端、最小化狀態啟動授權工作區；看過 320px PNG | 符合 |
| 124：Tailscale 私人連線，VPN 可能需切換 | `TailscaleGateway.ts:15,48,58` 驗證登入、DNS、Serve/Funnel/Foreground；設定與指南提供安裝及 Serve 說明連結 | gateway 單元用 CLI mock；缺失或設定漂移案例存在，非真帳號測試 | 符合；限制同 122 |
| 125：每位同事各自控制自己的 Poly，非共用主機帳號系統 | `remoteHandlers.ts:20` 使用該安裝 userData 的 remote-state；設定、手機頁及指南明示各自配對 | 未新增 SaaS／共用主機多租戶流程；測試狀態目錄彼此隔離 | 符合 |
| 126：桌面逐一勾選，新增工作區不自動授權 | `RemoteService.ts`、`RemoteSettings` 工作區勾選及危險確認；grants 依 wsId 顯式加入 | `requires desktop approval...`；E2E 先空清單，授權後僅一個可啟動工作區 | 符合 |
| 127：未授權工作區連名稱都不取得 | `/api/workspaces` 先 allowed filter 再 map id/name；mobile 只用該結果 | E2E 不存在 other-workspace 名稱；真 HTTP 空清單 assertion | 符合 |
| 128：7 天／30 天／永久，永久直到手動撤銷 | `PairLifetime` 三值；`RemoteSettings.ts:61` 三選項；server `approve` null 表示永久 | GUI 實走30天批准；真 HTTP 測7天過期、30天從批准起算及界線、365天後永久仍有效且撤銷失效；不宣稱三種期限均有GUI實走 | 符合 |
| 129：每次在電腦個別選，不同配對可不同期限 | lifetimes 以 pending.id 索引；approve 僅寫指定 device，不改其他期限 | 7/30/permanent 個別案例；未以全域設定重置期限 | 符合 |
| 130：QR 為主、手動碼備用，桌面核對批准及撤銷 | QRCode 本機產生 fragment URL；手機手動 code 及 label；雙端 verification；批准／拒絕／撤銷皆 desktop IPC | 新版 E2E 有 QR fragment 清除、拒絕後新手動碼、識別碼相同、批准及撤銷；桌面等待批准 PNG | 符合 |
| 131：離線直接回報，不保留待執行操作，恢復後再按 | `mobilePage.ts` fetch 10s timeout；存 opId 只供 GET 查詢；沒有排程／自動 POST 重送 | 補充 offline-unknown-walkthrough 五檢查PASS：離線refresh/query失敗及停用按鈕，恢復只GET原opId；全程1次POST、1分頁；使用傳輸abort，非真4G斷線 | 符合 |
| 132：情境推定方案一；選工作區／新分頁／顯示終端，縮小時恢復，不解鎖 Windows | `remoteHandlers.ts:22` restore/show/focus；`TerminalPanel.tsx:98` 選 ws、顯示終端及新項目；無解鎖機制 | E2E 先換 workspace、隱藏 panel、minimize 再按，檢查 GUI/命令/已恢復；鎖定未實測，不冒稱已驗 | 符合 |
| 133-1：預設7天、批准時計時、既有期限不延長，改期先撤銷 | desktop 選單 `?? 7`；approve 使用 now；無延長 API；設定和指南寫出撤銷後重配 | 30 天 createdAt/expiresAt 差值 assertion；永久 cookie 的瀏覽器清除限制已有說明 | 符合 |
| 133-2：QR／手動同需批准；離線與前景行為沿用前決議 | 沿用上列 130–132 相同實作；不存在背景排程或繞過批准入口 | 同上 | 符合 |
| 133-3：完整流程與 UI，固定能力、限速冪等、預設關閉、fail closed | SettingsPanel 掛 RemoteSettings；mobile 新頁；server 初始 null，不持久 enabled；requireShape 僅 wsId/opId；rate/launchInFlight/opId紀錄 | source 與 RemoteService 單元；恢復狀態保留授權但需重新 enable | 符合 |
| 工程預設：2分鐘一次性挑戰、單一瀏覽器秘密、拒絕／到期需新挑戰 | createChallenge 120000ms；pair 成功消耗 challenge、隨機 token 雜湊；verification 共用 pending | code replay、過期、批准前401、拒絕及新版手動配對測試 | 符合 |
| 工程預設：wsId+實際路徑；建立前／命令前皆重驗；不可借新路徑授權啟動舊 PTY | allowed 使用 native realpath；launch authorize 後保存 path；rendererReady 再比對存檔 path；撤銷 cancel pending | path-bound、path changed before ready、新路徑重授權不能重用舊 terminal 三案例 | 符合 |
| 工程預設：撤銷阻擋尚未送命令，不終止已啟動 Claude | cancel 僅 state=pending 才 close；已 sent 不受撤銷終止 | before-ready revoke 無 write；sent 後 revoke closed=0；E2E 撤銷後真 GUI 分頁仍存在 | 符合 |
| 工程預設：零授權有空狀態；Tailscale 缺失停止、不降級 | mobile `#empty`；gateway 找不到安裝即 reject；僅 127.0.0.1 listener 加私有 Serve | 真 E2E 空狀態；missing prerequisite／Funnel／設定漂移案例 | 符合 |
| 工程預設：成功只代表新增分頁及送固定命令；不保證 CLI 登入／就緒 | publicOp sent 訊息、mobile result、HelpCenter「已送出啟動命令」 | 真 CLI fixture 只接參數；文案明確引導查看桌面後續錯誤 | 符合 |
| 工程預設：每 opId 綁 device+ws，持久7天／最多1000，滿則拒絕 | launch 比對舊 op 的裝置/目標；save 在 spawn 前；prune 7天；length>=1000 回429 | 冪等與重啟單元存在；容量／不同裝置綁定本輪為 source 核對，未冒稱有專門實跑案例 | 符合 |
| 工程預設：重啟未完成 unknown；查無／逾時只查原ID、先看桌面再新手動操作 | constructor pending→unknown；/result 查無 unknown；mobile clearResult 明示先看電腦；不呼叫 launch 重播舊ID | 重啟不resend單元；補充走查以sessionStorage放入未存在UUID、真GET取得unknown，按鈕阻擋、手動及輪詢GET均不POST；明確先看電腦的ack只清除結果，不啟動 | 符合 |
| 工程預設：配對與啟動限速、冪等、競爭序列化，僅 enabled/有效授權接受 | 原子一次性 challenge；global/pair/device rate；launchInFlight 立即拒絕新競爭請求，沒有 backlog；舊已持久 opId 直接原結果；pending/2s 限制；ready 前重新 authorize；gateway await 後 generation 防止跨停用復活 | payload/rate/concurrent starts/同ID重送案例；已讀即時429與停用再啟用不復活兩個真 HTTP 新回歸；target-validation.txt已讀追加21項通過原始輸出 | 符合 |
| spec：Secure/HttpOnly/SameSite、只存雜湊、設定匯出不含遠端憑證 | cookie 屬性；remote-state 獨立持久檔；固定 IPC/type/channel；main sender frame 檢查 | 存檔不含 token 的 HTTP assertion；本輪只核規格存在，未代替安全軸完整審計 | 符合 |
| spec：每次 app start off；未知／關閉／renderer故障不恢復命令 | constructor 無自動 enable；index renderer gone/載入失敗/退出停用；已有 lifecycle 邊界修正 | restart unknown、gateway fail closed、in-flight enable取消案例；portable 待驗 | 符合 |
| AGENTS／spec：首次與手動導覽、完整指南同步 | GuidedTour 保持7步，第6步寫設定入口/已授權工作區；HelpCenter 新文章含安裝、配對、期限、離線、unknown、撤銷及bypass風險 | 已讀兩檔與新版 onboarding-help 測試，第6步及指南離線／unknown／撤銷／bypass斷言存在；target-validation.txt 237–250行含四項教學GUI通過 | 符合 |
| spec：真 Electron／真 IPC／真 PTY 與測試 seam 限制 | `remoteHandlers.ts:13` 要求 !app.isPackaged 且專用 env 才 fake gateway；E2E 真 HTTP proxy＋系統 Chrome | 不代表正式 portable 能使用假閘道，更不代表真 Tailscale/4G 已通 | 符合；外部／打包待驗 |
| 本輪 design-freeze：桌面設定／配對／授權、手機配對／啟動結果、TerminalPanel、Guide/Help 七區塊 | 逐區塊表對應六個存在的 frozen 路徑；baseline 包含設定增量、手機新頁、終端機及教學；source=null 明示直接實作，無假資料待接API | 本審逐區塊核 source，並讀 design-freeze.md、design-frozen.json、design-baseline.json；決議133授權原話與定稿敘述一致，未冒稱使用者看圖 | 符合 |

## 附件：證據版本與界限

- 人工已看 `.constellation/qa/remote-launch/` 五張 QA 圖：desktop-pending-30days、desktop-revoked、mobile-pair-pending、mobile-authorized-320、mobile-authorized-390。可辨識待批准與30天選擇、核對識別碼、授權工作區、撤銷後無有效配對、手機單鍵啟動與風險說明。跨次測試PNG不視為同一請求的身分比對證據；雙端相同由E2E斷言佐證。
- 已直接讀 `.constellation/qa/remote-launch/target-validation.txt`：typecheck exit=0；11 RemoteService＋7 gateway＋31 PtyManager，共49測試通過；build exit=0；6 GUI通過（四項教學、一項手機、一項本地AI）。後續同檔記錄生命週期修復後typecheck=0、19遠端單元通過、重建成功與手機GUI 1/1（28.7秒）。這是實跑原始輸出，非本審自行重跑，也不等同正式runner全量簽章。
- 補審已讀target-validation.txt追加的Queue capacity fix原始輸出：typecheck exit=0、14 RemoteService＋7 gateway共21項通過、build exit=0、手機GUI 1/1（23.1秒）。移除launch backlog的即時429與generation兩個真HTTP回歸有實跑支持，未改凍結UI。
- 正式票級T-011已有14項E2E紀錄；補充走查明確列在該紀錄之後，不偽稱14項原已涵蓋offline/unknown。正式full ship尚未全綠、portable smoke仍由根代理完成及收錄ship-report；這是剩餘交付驗證，不是本審新發現的產品阻擋。真Tailscale私人HTTPS與手機4G需實際安裝／帳號／裝置，本環境未驗；測試閘道不替代該外部鏈路。

### 離線與未知結果補審（2026-10-12）

直接核對 `offline-unknown-walkthrough.txt`、`run-offline-unknown-walkthrough.cjs`、三張新增PNG及spec驗收表，5項PASS與腳本斷言相符。真Electron／PTY與Chrome經既有未打包gateway seam連真HTTP；離線是browser offline加route abort，沒有mock回應內容。紀錄為launchAttempts=1、forwardedLaunches=1、resultQueries=9、offlineTransportAborts=2、cleanupErrors=[]。恢復連線查原opId且分頁維持1；查無UUID由sessionStorage注入，真GET產生unknown，至少一次2秒輪詢仍無POST；先看桌面的確認鈕只清結果、恢復可操作，不自動啟動。

新增PNG中，offline狀態有連線錯誤、停用啟動及同操作查詢；restored顯示原操作送出結果；unknown明示先查桌面再手動建立，啟動仍停用。證據符合決議131及工程預設的offline/unknown規則；它不模擬未送出的離線點擊，也不代替實際4G或crash實測，後者已有獨立重啟HTTP案例分工。期限證據分工為30天GUI、7天／30天／永久真HTTP，與更新後spec一致。未新增Spec缺陷，未重跑GUI，未宣稱full suite或portable通過。