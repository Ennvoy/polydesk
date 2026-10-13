# 訪談覆蓋：手機啟動 Claude bypass

## 已答

- 核心行為：手機一次操作須在 Polydesk 新增真實 Claude bypass 分頁，等同現有按鈕；僅有 Claude 遠端會話不符合需求。見 [決議 121](decisions/121-phone-launch-claude-bypass.md)。
- 網路使用場景：在外使用手機行動網路也可操作，需要安全遠端連線，且電腦與 Polydesk 保持運作。見 [決議 122](decisions/122-remote-launch-over-mobile-network.md)。
- 工作區操作：手機列出各工作區，各自提供 Claude bypass 按鈕，點擊即在該工作區新增分頁。資安與功能可用性同為驗收要求。見 [決議 123](decisions/123-mobile-workspace-buttons-and-security.md)。
- 連線架構：安裝 Tailscale，走私人連線；首次設定與既有手機 VPN 切換需求已告知。見 [決議 124](decisions/124-tailscale-private-mobile-access.md)。
- 操作身分：每人以自己的手機控制自己的電腦與 Polydesk，獨立配對與管理。見 [決議 125](decisions/125-each-user-controls-own-polydesk.md)。
- 工作區允許範圍：電腦端逐個勾選授權；新增工作區須另行授權，手機日常仍一按啟動。見 [決議 126](decisions/126-desktop-workspace-remote-allowlist.md)。
- 手機工作區清單：只取得並顯示已授權工作區，不洩漏未授權工作區名稱。見 [決議 127](decisions/127-mobile-list-authorized-workspaces-only.md)。
- 配對有效期：提供 7 天、30 天與永久；永久保留至手動撤銷，電腦端仍可撤銷。見 [決議 128](decisions/128-configurable-pairing-lifetime.md)。
- 有效期設定範圍：每次配對時在電腦端為該手機瀏覽器個別選擇期限，不同配對可不同。見 [決議 129](decisions/129-per-pairing-lifetime-selected-on-desktop.md)。
- 配對方式與授權：以 QR 碼配對，提供手動輸入一次性配對碼備用；兩種方式均由電腦端確認授權，完成後可在電腦端撤銷。期限沿用決議 128、129。見 [決議 130](decisions/130-qr-pairing-with-manual-code-fallback.md)。
- 離線結果：電腦關機或 Polydesk 無法連線時，立即回報無法連線且不保留啟動操作；恢復後由手機再次啟動。見 [決議 131](decisions/131-offline-launch-not-queued.md)。
- 桌面畫面影響：遠端啟動時切換至指定工作區與新 Claude 分頁、顯示終端機，最小化視窗時恢復；不解鎖 Windows 或繞過鎖定畫面。此方案依使用者描述的情境採用，並非使用者直接回答選項 1。見 [決議 132](decisions/132-remote-launch-brings-polydesk-to-foreground.md)。
- 出貨規格收斂：依使用者明確授權採用推薦基準，配對預設 7 天、30 天／永久仍可選，期限由電腦批准時間起算；調整期限需撤銷後重新配對。涵蓋完整流程與 UI、安全高風險、每人自己的 Polydesk，排除多租戶 SaaS。此為授權下的推薦決定，不代表使用者逐題確認。見 [決議 133](decisions/133-pairing-lifecycle-and-release-scope.md)。

## 角色與生命週期矩陣

| 範圍 | 狀態／處理 |
| --- | --- |
| 配對 | 未配對：拒絕遠端啟動；待批准：需電腦端明確批准；已批准：依選定期限有效並可撤銷；過期／撤銷：拒絕遠端啟動。期限預設 7 天，由批准時間起算；改期限須撤銷後重新配對。 |
| 使用者與裝置 | 每位使用者控制自己的 Polydesk；同一使用者可配對多個手機瀏覽器，各自獨立授權。多人／多裝置同時操作以限速、冪等及序列化避免競爭副作用。 |
| 電腦與連線 | 電腦或 Polydesk 關閉／不可達時立即回報、不排隊、不自動重送；Tailscale 缺失或不可用時 fail closed，不改走公開連線。最小化視窗可恢復，但不解鎖 Windows、不繞過鎖定畫面。 |
| 工作區 | 僅允許已授權工作區；未授權或新工作區拒絕啟動，須先在電腦端另行授權；工作區路徑遺失或已移除時停止並回報。 |
| 啟動與分頁 | 啟動中、Polydesk 關閉中或重複請求均須安全收斂，採固定啟動能力與冪等處理；網路逾時造成結果未知時不可自動重送，先查看桌面，再以相同 `opId` 查詢原操作結果。 |
| 配對與授權紀錄 | 配對挑戰 2 分鐘有效且一次性，綁定單一手機瀏覽器秘密；授權綁定 `wsId` 與實際路徑，建 PTY 與送命令前重驗。操作紀錄綁裝置與工作區，保留 7 天、最多 1000 筆；容量已滿拒絕新操作。細節見 [工程預設](decisions/engineering-defaults.md)。 |

## 工程推薦

- 固定 Claude bypass 啟動能力；不接受任意命令或擴大為一般遠端控制。
- 配對與啟動採限速及冪等；功能預設關閉，未明確授權或狀態不確定時 fail closed。
- 此功能涵蓋端到端流程與 UI，按安全高風險功能驗收；產品範圍為每人自己的 Polydesk，不含多租戶 SaaS。
- 配對拒絕或到期須重新申請；撤銷阻止尚未送出的命令，但不終止已啟動的 Claude。重啟時未完成操作標記結果未知；未知或查無紀錄均不自動重送，先查看桌面並使用原 `opId` 查詢。
- 啟動成功僅表示真實分頁建立且固定命令已送出；CLI 缺失、登入與後續錯誤由桌面端處理，手機提示查看桌面。Tailscale 不可用、授權不符或結果狀態不確定時 fail closed。
- 零個已授權工作區時顯示不洩漏工作區名稱的空狀態。
