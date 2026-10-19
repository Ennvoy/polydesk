<!-- constellation-map-synced-at: fe91716 -->
# Polydesk 專案現況地圖

## 模組索引

- `src/main/`：Electron 特權層。`ipc/router.ts` 註冊服務；`git/GitService.ts` 執行系統 Git；`git/gitSafeArgs.ts` 驗證 ref 與參數；`git/gitSerialQueue.ts` 協調同 repository 的讀寫屏障，同批唯讀可並行，狀態掃描最多兩個；`git/cleanup/core/`、`git/cleanup/local/`、`git/cleanup/remote/` 與 `store/cleanup/` 提供零副作用 preview、完整 retained-ref/worktree/endpoint lease、本機 CAS、遠端 compare-and-delete、refspec producer 清理、repository instance identity、write-ahead journal、claim 重建及 quarantine。`fs/FileWatcher.ts` 在 Windows 使用單一原生遞迴監看器，在其他平台或原生監看無法建立時沿用 chokidar。`remote/RemoteService.ts` 管理手機配對、期限、工作區授權及持久操作結果；`remote/TailscaleGateway.ts` 管理私人 HTTPS Serve，`remote/mobilePage.ts` 提供內嵌手機頁面。其餘模組負責 workspace、PTY、檔案、搜尋、LSP、AI 監控、狀態儲存與更新。
- `src/preload/`：固定白名單 IPC bridge，只暴露 namespaced API，不暴露 raw `ipcRenderer` 或 Node API。
- `src/shared/`：跨程序契約單一來源。`channels.ts` 定義 channel 白名單，`ipc.ts` 定義 request/response，`types.ts` 定義 Workspace、GitStatus、GitLogRef、GitWorktree 等模型；`remoteLaunch.ts` 集中遠端啟動 channel 型別、連接埠與固定 Claude bypass 命令。
- `src/renderer/`：React UI。`components/ActivityBar.tsx` 匯出水平 `WorkspaceToolbar`，由側欄 host 放在內容頂部提供檔案總管／搜尋／SCM／設定入口；`WorkspaceRail.tsx` 只管理工作區。`components/Settings/RemoteSettings.tsx` 提供電腦端啟用、配對批准／撤銷與工作區允許清單；`components/Terminal/TerminalPanel.tsx` 接收遠端啟動事件，待分頁尺寸就緒後回報，由 main 重驗後送出固定命令。`components/Help/` 提供 7 步首次導覽（第六步介紹手機遠端啟動）與含此功能的可搜尋完整指南；`TitleBar.tsx` 與設定共用重開入口。`components/SourceControl/SourceControlPanel.tsx` 負責 SCM 的變更、歷史、分支、stash 與清理恢復卡；`scm.css` 保證窄側欄直向呈現，`layout/DockLayout.css` 提供低彩度版面顯隱工具列。`components/Worktree/` 已有本地／遠端分支來源分流；`state/` 管理工作區、Git snapshot 與導覽匯流排；`theme/compactButtons.css` 提供無框小圖示按鈕樣式。
- `tests/` 與並置 `*.test.ts`：單元、整合與安全邊界測試；`src/main/remote/` 覆蓋服務與 gateway 契約；`e2e/remote-launch.spec.ts` 使用本機 HTTP／GUI 驗證手機配對與啟動旅程。E2E 其餘部分以真 Electron、真 Git／bare remote、真檔案系統驗證完整鏈路。
- `specs/`：`requirements.md`、`design.md`、`architecture.md`、`tasks.md` 分別保存需求、安全／IPC 設計、架構與迭代歷程。部分舊架構路徑已漂移，使用前須對照實際程式。
- `build/`：圖示與 electron-builder 後處理；portable 產物輸出至 repository 外的 `../polydesk-dist/`。

## 主要資料流與邊界

- Git／SCM：`SourceControlPanel` → preload 固定 `git:*` channel → `GitService` handler → repository 共用讀寫佇列（同批唯讀並行、狀態掃描上限 2、寫入維持前後屏障） → `execFile` 系統 Git → 結構化結果回 renderer。
- 歷史：固定 `git:logPage` IPC 保留 `--all --topo-order` 範圍；首次回傳 20 筆、後續每頁 10 筆，前後檢查 refs 與分頁邊界，歷史變動時 renderer 從前 20 筆重讀（決議 120）。
- 清理進度：`cleanupProgressPolling.ts` 等上一筆查詢完成才排下一筆；SCM 以世代與停止旗標隔離舊工作區／操作結果，避免狀態查詢積壓。
- AI 狀態：`ClaudeStatusMonitor.runOnce` 一輪共用工作區清單；全部無 PTY 時逐工具轉 idle 並略過程序掃描及全域紀錄讀取，活躍路徑仍在非同步讀取後重查當下 PTY。
- 完整清理：renderer → `git:cleanupPreview/Execute/Status/Cancel/Resume/ImportEvidence` 固定 IPC → repository queue → Git/磁碟/endpoint lease 重驗 → userData 版本化 journal/claim；preview 零副作用，execute 依序執行本機 worktree/ref/metadata，再處理遠端 expected-OID 與 tracking ref，部分結果沿 checkpoint 恢復。
- 工作區：renderer store／workspace rail → `workspace:*` → `WorkspaceManager` → `StateStore` userData 狀態檔。
- Worktree：SCM／建立對話框 → `git:worktree*` → `GitService` → `WorkspaceManager` 納管；分支互斥以 `git worktree list` 的即時結果為準。
- Terminal：xterm → `pty:*` → `PtyManager` → ConPTY；main 主動推播輸出。Windows 一律用 node-pty 內附 conpty.dll（`USE_CONPTY_DLL`，decision 116——內建 ConPTY 吞滑鼠追蹤序列、重繪吃字；逃生口 `POLYDESK_CONPTY_DLL=0`）。
- 手機遠端啟動：`RemoteSettings` → 固定 `remote:*` IPC → main `RemoteService`／`TailscaleGateway`；手機頁由 main 提供，Tailscale Serve HTTPS `:8443` 只代理至 loopback `127.0.0.1:49387`。啟動操作建立真實 PTY 後推播給 `TerminalPanel`，待 renderer 確認尺寸就緒才回報 `remote:ready`，main 重驗配對與工作區授權後送出固定命令。
- 檔案／搜尋／LSP：renderer 元件 → 對應固定 IPC → main service；檔案 watcher 再推事件回 renderer。
- Windows 檔案監看：每個已載入工作區各持有一個原生遞迴監看器；事件保留工作區 containment、junction 檢查、短暫寫入合併與洪水時根目錄對帳。`.next` 僅自檔案監看排除，搜尋範圍不變（decision 117）。

## 手機遠端啟動 Claude bypass

- 遠端功能每次啟動 Polydesk 預設關閉；電腦端明確啟用後才開 loopback HTTP。Tailscale gateway 只接受符合本機代理目標的私人 Serve HTTPS `:8443 → 127.0.0.1:49387`，Funnel、連接埠衝突或私網身分改變會拒絕或停用。
- 運行時每 10 秒檢查私人連線；CLI 暫時失敗或未連線時先暫停受理所有手機請求與啟動操作，檢查成功才恢復，連續 3 次暫時失敗則停用。Funnel、位址／代理設定改變及未知安全設定立即停用。設定顯示具體原因和重試進度，既有 audit 保存暫停、恢復與停用原因，跨重啟仍可查閱；恢復不重播已取消的啟動。
- 配對採兩分鐘一次性 QR／手動碼挑戰、雙端核對後電腦批准；期限逐手機瀏覽器選 7 天（預設）、30 天或永久，自批准時間起算。工作區授權綁定 ID 與實際 realpath，建立 PTY 與送命令前重驗；手機只取得已授權工作區。
- 每個持久 `opId` 綁定配對與工作區，結果最多保留 7 天／1000 筆；未完成操作在重啟後標為未知，不排隊、不自動重播。main 等 `TerminalPanel` 回報尺寸 ready 並重驗後才送出 `claude --dangerously-skip-permissions`；成功只表示真分頁與固定命令已送出，CLI 缺失或登入等後續錯誤須看桌面。
- 遠端啟動切到指定工作區、新 Claude 分頁並顯示終端機；最小化時恢復 Polydesk，但不解鎖 Windows。`GuidedTour` 第六步與 `HelpCenter` 指南已說明入口、配對、授權、期限、錯誤與安全界線。

## Git 分支現況

- 2026-09-28 Git 完整稽核記錄位於 `specs/git-audit-2026-09-28.md`：涵蓋取消暫存、放棄變更、分支／標籤同名、合併提交檔案清單、common-dir 序列佇列、外部 diff 與 SCM 非同步結果；驗證及發布證據以該檔即時狀態為準。
- SCM 失敗回饋提供原因、處理方式及可摺疊技術細節；失敗後仍重新讀取狀態，切換工作區忽略前一工作區結果。完整指南說明含未追蹤檔案的保存範圍、合併衝突與 stash pop 衝突保留 stash 的處理方式。

- `GitService.branch(list)` 以 `for-each-ref` 讀取本地與 remote-tracking refs，再以實際 `git remote` 清單的最長前綴組成結構化 `{ remote, name, ref }`；因此合法的斜線 remote 不會被誤拆，並排除 remote `HEAD`。
- shared IPC 的 `git:branch` 支援 `list | create | checkout | delete-local | delete-remote`；list 同時保留既有扁平 `remotes` 相容 worktree 對話框，並提供 SCM 使用的 `remoteBranches` 結構化身分。
- SCM 分支頁分成本地與遠端兩個可獨立收合群組，顯示各自數量；每列 `⋯` 與右鍵共用選單，目前分支或 worktree 使用中的本地分支會顯示具名停用原因。
- 舊名稱式 `git branch -d`／`git push --delete` 產品入口已停用：本機先重驗 target/baseline/retained refs 與全部 worktree，遠端先重驗 effective push endpoint/expected OID，再由同一 journal 依序收斂；checkout 競態會恢復 local ref，remote tip／hidden ref 不確定則保留待辦。
- 刪除錯誤回傳結構化 code；顯示前會中和原始 Git 訊息的 bidi 與 C0 控制字元，不靠在地化 stderr 判斷未合併狀態。

## 已知缺口與地雷

- remote 名本身可含 `/`，不可用第一個斜線拆 remote-tracking 顯示字串；應沿用結構化 `remoteBranches`。
- 遠端刪除可能因認證、網路、逾時、預設分支或保護規則被拒絕；失敗需結構化分類並顯示可行下一步，不得偽裝成功。
- `remotes` 是本機 remote-tracking snapshot；未 fetch／prune 時可能過期。現有 fetch 未帶 `--prune`。
- `remotes` 扁平欄位仍供既有 worktree 建立對話框使用；SCM 身分判斷不得退回依賴它。
- 導覽內容若因主要介面變動而失效，應調升 `ONBOARDING_VERSION` 讓舊完成狀態重新開始；一般功能新增、變更或移除則必須同步更新導覽與完整使用指南。
- Windows clipboard 可能被其他桌面程式暫時獨占；多個不相干 clipboard E2E 同時讀回空值時，先驗證作業系統 roundtrip 與 owner，再判斷產品回歸，避免為環境鎖誤改產品或強關使用者程式。
- 手機遠端功能已有 loopback HTTP、真 Electron／GUI 與完整 ship 綠燈；真 Tailscale 帳號及手機 4G 尚未量測，不以本機 gateway 代替外部鏈路證據。完整結果見 `.constellation/archive/2026-10-12-private-mobile-claude-launch/ship-report.md`。

## 終端機導覽移除現況

- 終端機內容／對話導覽軸已完整移除；Claude、Codex、Agy 與一般 shell 都不再渲染導覽 DOM 或預留左側空間。
- `TerminalView` 不再掃描 xterm buffer、建立節點、訂閱導覽用 scroll／resize 事件或攔截 `Alt+↑`／`Alt+↓`；`terminalNavigation` 純函式、樣式與專用 E2E 亦已刪除。
- 先前移除的 `ai:conversation` shared／main／renderer 鏈路、Claude transcript reader、Codex rollout reader、session 配對與背景輪詢維持不存在。
- `POLYDESK_TERM_ID` 仍供 Claude hook 精確清理同 terminal 的殘留狀態；xterm scrollback、AI 快捷啟動、PTY 尺寸同步及工作區狀態徽章不受影響。

## Dock 版面顯隱現況

- `DockLayout.tsx` 以自訂 `PolydeskDockTab` 接管側欄、編輯器與終端機標頭的 `×`；三者都走 group `setVisible` 原地顯隱，不移除 panel 或 dispose component。
- 編輯器／終端機切換顯隱時，`layoutPersist.togglePanelPreservingSize` 會記住可見側欄的實際寬高，待 dockview 重分配空間後設回；上方按鈕、檢視選單與面板內關閉入口共用同一路徑。
- 顯隱狀態仍由 dockview panel／group 推導並寫入 layout envelope；重啟還原與一鍵重設契約不變。

## 工作區導航與雙層式教學現況

- 原 48 px 垂直活動列 DOM 已移除；`WorkspaceToolbar` 將檔案總管、搜尋、原始碼控制與設定整合到側欄頂部，貼近受控內容並保留 SCM 即時角標、active、tooltip 與 `aria-pressed` 契約；工作區欄標頭只保留工作區管理入口。
- `GuidedTour` 有 7 步，第一次啟動自動出現並以 schema v3 的 `onboarding` 欄位保存完成、略過或中斷進度；手動重開不改寫首次狀態，導覽只還原自己暫時顯示且未被使用者覆寫的版面。
- `HelpCenter` 是可搜尋的完整使用指南，涵蓋一般使用者可操作功能、畫面狀態、處理方式與安全導航；「說明」選單與設定都可重開導覽或指南。
- 專案根目錄 `AGENTS.md` 與 `CLAUDE.md` 已記錄同步規則：使用者可見功能新增、變更或移除時，必須檢查並更新導覽與使用指南。

## 冷啟動視窗現況

- portable 解壓期間由 electron-builder `portable.splashImage` 顯示 420×230、24-bit RGB、沒有圓圈的靜態 BMP。`build/portableBuilder.js` 複製 builder 25.1.8 的 NSIS 模板，強制每次啟動使用 `$PLUGINSDIR/app`（此版 builder 的 `unpackDirName=false` 仍會產生打包時固定的 KSUID），並在 NSIS 自動顯示標準框前將該框移出可見桌面；品牌 BMP 留在中央。交接區段讓原生 BMP 保持到 Electron 主視窗已顯示或失敗視窗已顯示，透過本次獨立解壓目錄中的固定就緒標記收尾；正常路徑不建立 Electron splash。解壓器仍等 app 結束再清理，僅對自己的解壓目錄做最多 50 次／100ms 的有界重試；持續占用時以失敗狀態退出，程序狀態未知則保留檔案。啟動前 Windows 驗簽、防毒與排程仍可延後首個畫面（決議 119）。
- renderer 先載入工作區狀態再 render，`App` commit 後以固定白名單 `app:rendererReady` 握手；main 同時取得正確 webContents 的 `ready-to-show` 與 renderer-ready 才顯示主窗、寫入 portable 就緒標記，隨後由原生解壓器關閉 BMP 並記錄 `window:interactive`。
- 主畫面載入／初始化失敗時才建立 sandbox、無 Node 整合、禁止外部導航的本機 `data:` 失敗視窗，顯示具名原因並提供重試或退出；主視窗尚未 interactive 時，第二實例事件不會提前把隱藏主窗顯示出來。
- `e2e/perf.spec.ts` 的冷啟動 p95 3 秒門檻維持未放寬；既有環境豁免必須在出貨證據中明確記錄，不得把 splash 首次顯示當成可互動時間。
