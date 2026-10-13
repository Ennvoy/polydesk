# T-011 手機與桌面完整操作流程
status: done
blocked-by: T-010
zone: src/renderer/components/Settings/**, src/renderer/components/Remote/**, src/renderer/components/Terminal/TerminalPanel.tsx, src/renderer/components/Help/**, e2e/remote-launch.spec.ts, e2e/onboarding-help.spec.ts, e2e/terminal-ai-launch.spec.ts, e2e/workspace-switch-*.spec.ts, README.md, CHANGELOG.md, package.json
exclusive:

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

提供電腦端設定與手機操作介面，讓使用者完成私網配對、逐個授權工作區，並由手機一鍵在自己的 Polydesk 啟動固定 Claude bypass。畫面切換、批准／撤銷、結果回饋、離線查詢與安全教學需涵蓋完整操作旅程；沿用既有 Polydesk 架構，不提供多租戶 SaaS 帳號功能。

## 驗收條件（合成階段寫定，逐條可勾）

- [x] Settings 主頁可進入 RemoteSettings；遠端功能預設關閉，每次重新啟動 Polydesk 須再次明確啟用；可管理 Tailscale 連線狀態、配對與工作區授權。
- [x] 新增手機 Remote Page，僅經私人 gateway 使用；配對可掃 QR 或手動輸入備用碼，顯示雙端核對識別資訊，提交後等待電腦批准；拒絕、逾時或過期時顯示原因並要求重新申請。
- [x] 電腦批准流程可為每個手機瀏覽器選 7 天（預設）、30 天或永久；顯示批准時間起算與永久直到手動撤銷。已批准期限不可直接修改，須撤銷後重新配對。
- [x] 手機清單只列出已授權工作區；零授權工作區顯示空狀態且不洩漏未授權名稱。電腦端新增工作區後仍須另行授權。
- [x] 手機在目標工作區按一次 Claude bypass 後，桌面切換至該工作區與真實新 Claude 分頁、顯示終端機；最小化時恢復 Polydesk 視窗。不得解鎖 Windows 或繞過鎖定畫面。
- [x] 桌面批准、工作區切換、PTY 建立、終端機初始尺寸就緒與命令送出順序有明確握手；手機只在真分頁建立且固定命令送出後顯示成功。
- [x] 電腦端可撤銷每個配對及工作區授權；撤銷阻止尚未送出的命令，不終止已啟動的 Claude。CLI 缺失、登入及後續錯誤由桌面終端機呈現，手機提示查看桌面。
- [x] 離線時立即回報、不排隊、不自動重送。網路逾時或重啟造成結果未知時，手機提示先查看桌面並以原 `opId` 查詢；未知或查無紀錄不提供自動重送操作。
- [x] GuidedTour 維持 7 步首次／手動導覽契約，HelpCenter 完整指南加入入口、操作步驟、狀態、錯誤處理與安全提示；相關 selectors、回歸測試及新流程一併更新或驗證。
- [x] README、CHANGELOG、版本與正式建置流程同步本功能及使用方式；portable 成品的路徑、大小與 SHA-256 由出貨階段另行實測及回報。
- [x] 真 Electron 驗收涵蓋配對、批准／拒絕、期限、工作區切換、真實分頁與固定命令、撤銷、離線及未知結果，以及導覽／指南與工作區切換回歸。

## 決議記錄（實作期小事自決落此，可追溯）

- 決議 121–133 與 `engineering-defaults.md` 定義本票行為契約；決議 133 已授權依推薦完成至出貨，不再就同一範圍重複詢問核准。保留 `.constellation/config.json` 的 `approved: true` 原值。
- UI 設計 scaffold 已先完成；`blocked-by: T-010` 用於正式 ticket runner／驗收編排，不表示必須先關閉 core 才能開始 UI。實作可先建測試並接線既有設計 scaffold。票編排與驗證簽章在正式驗收前補建；目前不預填驗證簽章、不勾選驗收項目。
- E2E grep 依現有實際測試名稱涵蓋 `remote-launch`、`onboarding-help`、`terminal-ai-launch`、`workspace-switch-badge`、`workspace-switch-stale`；使用寬廣的標題關鍵字，不只挑單一測試。
- 正式驗收改以完整領域檔案群涵蓋手機、導覽、AI 啟動、終端管理／顯隱、工作區切換，避免標題「工作區」把不相關的 Git 全套納入票級重跑；出貨全量不受縮圈影響。成品雜湊留在 push 後的出貨步驟，票面不提前聲稱已有成品。

## 驗證指令

先完成 production build，再執行真 Electron 領域旅程；以下指令均已完成，結果見下方證據。

- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm run build`
- `cmd /c npm run e2e -- e2e/remote-launch.spec.ts e2e/onboarding-help.spec.ts e2e/terminal-ai-launch.spec.ts e2e/terminal-manage.spec.ts e2e/toggle-terminal.spec.ts e2e/workspace-switch-badge.spec.ts e2e/workspace-switch-stale.spec.ts --workers=1`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-10-12T10:25:39.366Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    > polydesk@0.40.0 typecheck
    > tsc --noEmit --pretty false
    ```
  - `cmd /c npm run build`（exit 0）
    ```
    ../../out/renderer/assets/solidity-yHOxYChb.js                                        26.03 kB
    ../../out/renderer/assets/jsonMode-nlsZrf9Z.js                                        29.12 kB
    ../../out/renderer/assets/tsMode-Cy3ymitH.js                                          40.32 kB
    ../../out/renderer/assets/freemarker2-CrJjAoDE.js                                     42.10 kB
    ../../out/renderer/assets/lspLanguageFeatures-BpcZWsOg.js                             61.69 kB
    ../../out/renderer/assets/addon-webgl-BEDhrLCz.js                                    139.86 kB
    ../../out/renderer/assets/index-CFXIps_v.js                                        9,642.74 kB
    ✓ built in 1m 59s
    ```
  - `cmd /c npm run e2e -- e2e/remote-launch.spec.ts e2e/onboarding-help.spec.ts e2e/terminal-ai-launch.spec.ts e2e/terminal-manage.spec.ts e2e/toggle-terminal.spec.ts e2e/workspace-switch-badge.spec.ts e2e/workspace-switch-stale.spec.ts --workers=1`（exit 0）
    ```
      ok  8 e2e\terminal-manage.spec.ts:55:5 › 雙擊迷你標頭 → 就地改名，未命名時自動編號 (7.6s)
      ok  9 e2e\terminal-manage.spec.ts:86:5 › 拖曳迷你標頭 → 調整並排順序 (8.6s)
      ok 10 e2e\terminal-manage.spec.ts:125:5 › 拖曳排序（往後拖）：把前面的 pane 拖到後面也要能動 (9.3s)
      ok 11 e2e\terminal-manage.spec.ts:162:5 › 改名按 Escape 取消 → 不保存（沿用原名） (7.0s)
      ok 12 e2e\toggle-terminal.spec.ts:9:5 › toggle 終端機顯隱：setVisible 不 dispose、隱藏騰出空間、再開原地重現 (7.7s)
      ok 13 e2e\workspace-switch-badge.spec.ts:9:5 › 點工作區列項的徽章格（非名字按鈕）也能切換工作區（整列可點） (6.1s)
      ok 14 e2e\workspace-switch-stale.spec.ts:10:5 › bug1：快速切換時前一工作區的慢 git 載入不覆蓋當前（取消 stale） (10.5s)
      14 passed (2.9m)
    ```
  - 耗時：合計 330s｜cmd /c npm run typecheck -- --pretty false 22s｜cmd /c npm run build 131s｜cmd /c npm run e2e -- e2e/remote-launch.spec.ts e2e/onboarding-help.spec.ts e2e/terminal-ai-launch.spec.ts e2e/terminal-manage.spec.ts e2e/toggle-terminal.spec.ts e2e/workspace-switch-badge.spec.ts e2e/workspace-switch-stale.spec.ts --workers=1 177s
  - sig: 0fcc57f2e03d20d31ecd3e1e8e596195cecf9e0b03d8055750dd0bf581c2e182

## 正式票級驗證後的補充走查

2026-10-12T11:28:10.748Z，主執行端在同一正式建置上完成真 Electron／PTY／Chrome／loopback HTTP 的手機離線、恢復與查無紀錄流程，5 項檢查全通過；僅啟動一次、轉送一次，9 次結果查詢沒有再次 POST 或增加分頁，隔離測試 listener／瀏覽器／Electron 均收妥。此補充不是上方 14 個正式 E2E 的一部分，也不是新的全量簽章。原始結果及三張狀態截圖在 `.constellation/qa/remote-launch/offline-unknown-walkthrough.txt`，重跑腳本同目錄 `run-offline-unknown-walkthrough.cjs`。Tailscale 使用既有未打包 E2E gateway；固定命令由隔離測試 CLI 接住，沒有驗證真帳號、行動網路或 Claude 登入就緒。
