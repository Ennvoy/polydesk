# Polydesk 更新旅程

本文件依 Git 歷史整理 Polydesk 從專案骨架到目前 dogfood 版本的演進。內容以使用者可感知的功能、修正、安全性、效能及驗證為主；單純同步 `.flow` journal、ledger 或回填 SHA 的維護 commit 不另列為產品更新。

- 歷史範圍：2026-06-28 起
- 來源：`git log --reverse --no-merges`
- 內部需求、驗證與 dogfood 編號：[`specs/tasks.md`](specs/tasks.md)
- 版本規則（2026-07-15 拍板）：以**版本分節**整理，每完成一批交付即 minor bump＋打 tag＋本檔補節；app 內版本顯示的唯一來源是 `src/shared/releaseNotes.ts`（單測釘死與 `package.json` 同步）。

## v0.30.0（2026-08-17）

Git 分支與 worktree 現在共用同一套可恢復完整清理流程；側欄切換入口也移到受控內容正上方，減少工作區管理與側欄檢視混在一起的認知負擔。

- 對應功能 commits：`c871d8a`、`ec33f61`、`70d3d74`、`01339c9`、`f64aa9a`、`1619f45`、`fe91716`。

### 2026-08-13｜可恢復的分支／worktree 完整清理與側欄頂部入口

- 本地分支、遠端分支與 worktree 完整清理統一為兩階段：第一階段只選範圍且零副作用；第二階段重新掃描並顯示可能失去的 commit、dirty／locked／prunable worktree、local metadata、遠端 endpoint 與 expected OID。
- 目前分支可先切換到使用者選定的保留分支；linked worktree 會先關閉 Polydesk 資源，再清理資料夾、Git 登記、本地 ref、branch config 與 reflog。執行錨點固定採用仍會存活的主工作樹，避免刪除中的工作目錄讓 Git 子程序失去 cwd。
- 遠端清理逐 endpoint 明確 opt-in，使用 expected-OID compare-and-delete；tip 變動、receive-pack 無法證明、認證／網路／保護規則失敗均保留為 stale／unknown，不會冒充成功。
- write-ahead journal 在第一個不可逆步驟前落盤，逐步 checkpoint；多 endpoint 部分完成時不會把仍可重試的 remote-tracking ref 誤記成永久保留，重啟後只重試未完成項目並在全部 producer 收斂後以 CAS 清理本機 ref。
- 出貨複核補強 journal payload checksum 與 repository generation 驗證；quarantine 待辦提供嚴格 checksum 證據匯入，並在 SCM 顯示最近 checkpoint。完整清理固定先完成本機 worktree/ref/metadata，再處理使用者勾選的遠端 endpoint。
- 不同名稱的實際 upstream 會在使用者開啟遠端清理後預先勾選；單獨刪除 worktree 資料夾也必須再確認外部程序可能於確認後寫入的殘餘風險。
- 舊名稱式 `git branch -d/-D` 與直接 `git push --delete` 破壞性產品旁路停用；worktree 不使用全域 prune，所有入口共用 repository queue、lease 與 journal。
- 檔案總管、搜尋、原始碼控制與設定入口從工作區欄移到側欄頂部；工作區欄只管理專案，SCM 角標、active、tooltip、鍵盤與無障礙狀態維持不變。
- 依真 Electron 畫面回饋降低版面顯隱工具列的彩度，以底線呈現開啟狀態；窄側欄的完整清理待辦改為直向響應式卡片，冗長 endpoint／Git 診斷預設折疊，並補足文字對比。
- 首次 7 步導覽因 selector 與主要資訊架構維持相容而不調升版本；完整使用指南已同步兩階段操作、unknown／部分結果／恢復待辦與高風險提示。
- 影響 renderer 側欄與 SCM、shared IPC／清理契約、main Git／journal／worktree／remote 清理服務、真 Git／Electron 回歸與發布文件；不變更使用者 repository schema 或環境變數。

### 驗證

- T-008 票級 runner 4/4 指令通過：typecheck、正式 build、16 個目標 Vitest 檔 89/89，以及 8 個真 Electron 清理 E2E 全綠。
- 真 Electron 直接驗證已合併／未合併風險、目前分支切換、worktree 三種範圍、遠端 tip 變動、多 endpoint 部分失敗、重啟待辦與繼續收斂，並查驗真實 refs、worktree 登記、資料夾與 bare remote 最終狀態。
- 最終 ship runner 20/20 指令全數 exit 0，總耗時 1,962 秒：typecheck、正式 build、77 個 Vitest 檔 626/626，以及 12 個單 worker Electron E2E shard 共 115 通過；3 個需真 AI 帳號的 dogfood 依條件跳過，`REQ-PERF-001` 依既有核准豁免分離。
- Standards 複核發現 endpoint 技術細節可能殘留到後續不相干錯誤，修正後以 typecheck、build 與遠端多 endpoint 部分失敗真 Electron 案例重驗；最終 Standards／Spec 均為 0 blocker、0 suggestion。完整 runner 證據簽章 `adf2926ff98a9fab76ef452f544877569c6c550fb1ab305291fc09306fd032bb`。

## v0.29.0（2026-08-12）

portable 啟動不再先顯示無法轉動的靜態 BMP、關閉後再跳出 Electron splash；自解壓完成後只顯示一個具有轉圈動畫的開啟畫面，避免兩段視窗交接造成的閃爍與誤解。

- 對應功能 commit：`b0523ff`

### 2026-08-12｜啟動畫面只保留單一動畫視窗

- 移除 electron-builder `portable.splashImage` 與已無用途的 `build/portable-splash.bmp`，NSIS 自解壓器不再建立靜態啟動畫面。
- 保留既有 420×230 Electron splash、CSS 轉圈動畫、原生 `show` 後初始化、`ready-to-show`／renderer-ready 雙重交接，以及失敗重試與退出流程。
- 明確接受單一 EXE 自解壓期間短暫沒有畫面的取捨；這段發生於 Electron 程式碼啟動前，換取整段流程不再出現兩個 splash 視窗。
- 封裝契約測試改為禁止重新設定 `splashImage`，修正前確認收到 `build/portable-splash.bmp` 並失敗，修正後通過。
- 完整 shard 在 Windows 負載下反覆於真 Git 分支／歷史 E2E 的不同 12–15 秒等待點失敗；分支刪除驗證改為先等產品 UI 完成，再一次性查真 Git，避免外部 Git 輪詢與 app 刷新競爭並產生暫時 broken ref。已觀察到的分支載入、刪除結果、錯誤訊息與歷史列等待改為案例專屬 30 秒，分支整案上限 180 秒；產品斷言與全域門檻不變。
- 修正分支切換成功後的 UI 收斂 race：Git checkout 成功便立即顯示目標分支，再執行完整 status refresh；不再等待慢速 refresh 才更新，亦不會從尚未同步的 status ref 讀回舊分支。
- 修正工作區剛切換時，延後執行的 SCM 初始化可能覆蓋使用者剛選擇之「歷史／分支」分頁的 race；分頁重設改在畫面可互動前完成。
- 真實 Windows 剪貼簿 E2E 在送出 Copy／Paste 前先讀回確認測試哨兵，檔案剪貼簿也在按鍵前確認 `FileDropList`，避免 OS clipboard service 暫時拒絕存取時誤判產品失效。
- worktree 效能量測先隔離 SCM 初始 refresh 的共用 Git 佇列；首批超過既有 1,500 ms regression ceiling 時保留慢值並再取同規格確認批次，產品 300 ms budget 與 regression ceiling 均未放寬。
- 首次導覽與完整使用指南經檢查不受影響：入口、步驟、畫面狀態、錯誤處理與高風險提示均未變更，因此不調升導覽版本，也不修改程式內指南內容。
- 影響 Windows portable 封裝、啟動畫面說明、版本資訊與發布文件；不影響工作區資料、renderer 主介面、IPC 白名單或終端程序。

### 驗證

- 最終 ship runner 20/20 指令全數 exit 0，總耗時 2,340 秒：typecheck、正式 build、67 個 Vitest 檔 572/572，以及 12 個單 worker Electron E2E shard 共 112 通過；3 個需真 AI 帳號的 dogfood 依條件跳過，`REQ-PERF-001` 依既有核准豁免分離。
- splash 真 Electron 3/3、Git shard 4 11/11、editor clipboard shard 2 9/9（另 1 個真 Codex dogfood skipped）均在最終完整輪次通過；Windows clipboard service 曾回 Win32 access denied，重建其獨立使用者服務後，Copy／Paste 壓測 6/6 與完整 shard 皆綠。
- 最終 worktree 實測：list p50 294 ms、p95 312 ms、n=3；p95 略高於 300 ms 產品 budget，故只記錄 regression guard 通過，不宣稱每輪嚴格達標。create p50／p95 3,226 ms、n=1，低於 5 秒 budget。
- runner 證據簽章 `20d8a5cc5b48993627e83693a927936155b20c7c584f15761f41daac42b4a408`，歸檔於 `.constellation/archive/2026-08-12-portable-single-animated-splash/ship-evidence.md`。

## v0.28.0（2026-08-11）

雙擊 portable EXE 後，啟動器進入自解壓便顯示 Polydesk 開啟畫面，Electron 能建立視窗時盡快接手，同時不為展示 splash 延長主程式啟動。Windows 驗簽／防毒前置與兩程序交界仍不保證零延遲。

- 對應功能 commit：`b8eb542`

### 2026-08-11｜啟動畫面立即顯示

- portable 封裝新增 420×230、24-bit RGB 的 Polydesk BMP，自解壓期間由 NSIS 原生顯示；Electron 啟動後以同尺寸既有 splash 盡快接手，減少程式碼尚未執行時的等待感。
- Electron splash 原生視窗建立後立即置中顯示，再載入既有品牌內容；主初始化等待原生 `show` 事件後才開始，讓使用者先取得可見回饋。
- 移除固定 250 ms 顯示 timer，不設定最低停留時間；主視窗仍須同時通過 `ready-to-show` 與 renderer-ready 握手才會交接。
- 新增 portable BMP 格式／尺寸封裝契約、splash 建立到原生 `show` 事件的主程序埋點與真 Electron 回歸，保留 sandbox、無 Node 整合、外部開窗封鎖、失敗重試與退出驗證。
- 首次導覽與完整使用指南經檢查不受影響：入口、步驟、畫面狀態、錯誤處理與高風險提示均未變更，因此不調升導覽版本，也不修改程式內指南內容。
- 影響 Windows portable 封裝、Electron 主程序冷啟動時序、開啟畫面 E2E、版本資訊與發布文件；不影響工作區資料、renderer UI、IPC 白名單或終端程序。

### 驗證

- 票級 typecheck、正式 build、版本／BMP 契約單測 4/4 與 splash 真 Electron 3/3 全綠；實際啟動 `Polydesk-0.28.0-portable.exe`，從原生 HWND 擷取到 420×230 完整品牌 splash，暖啟動約 825 ms 顯示。
- 最終 ship runner：67 個 Vitest 檔、572/572 案全綠，正式 build 通過；12 個單 worker Electron E2E shard 共 112 通過、3 個需真 AI 帳號的 dogfood 依條件跳過，`REQ-PERF-001` 依既有核准豁免分離。
- 首輪完整 runner 在既有 F-13 worktree 案發生一次按鈕等待時序 flake；單案 1/1 與修正後完整 runner 最後分片皆通過。Spec 與 Standards 獨立複核最終皆為 0 blocker、0 suggestion。

## v0.27.0（2026-08-10）

將檔案總管、搜尋、SCM 與設定移到工作區標頭，並以首次導覽、可搜尋的完整使用指南與冷啟動開啟畫面降低第一次使用成本。

- 對應功能 commit：`ad93a35`

### 2026-08-10｜工作區標頭、首次導覽與啟動畫面

- 移除最左側 48 px 固定活動列，四個入口改放工作區標頭；保留目前檢視、SCM 即時變更角標、無障礙狀態與側欄尺寸契約。
- 新增只在第一次啟動自動出現的 7 步導覽，保存完成／略過／中斷續接狀態；「說明」與設定都可手動重開，且手動導覽不會改寫首次狀態。
- 新增可搜尋的完整使用指南，涵蓋工作區、檔案、搜尋、Git／worktree、AI commit 草稿、編輯器、終端機、AI 用量、版面、設定及安全問題排除。
- 冷啟動較久時顯示 420×230 輕量開啟畫面；主視窗等待工作區載入與 renderer-ready 握手後才交接，失敗時提供重試或退出，第二實例不會提前顯示未就緒主窗。
- 專案 `AGENTS.md` 與 `CLAUDE.md` 加入長期維護規則：使用者可見功能新增、變更或移除時，必須同步檢查並更新導覽與使用說明。
- 影響 renderer 工作區／說明／版面、main 啟動生命週期、shared IPC／持久化 schema、真 Electron 回歸與發布文件；既有設定會由 schema v2 安全遷移至 v3。

### 驗證

- 票級 typecheck、正式 build、StateStore 28 案、工作區／SCM 2 案、啟動畫面 3 案與 onboarding/help 4 案全綠；出貨審查修正後 renderer security baseline 8/8 與 splash／shell 4/4 通過。
- 最終 ship runner：66 個 Vitest 檔、571/571 案全綠，正式 build 通過；12 個單 worker E2E shard 共 112 通過、3 個真 AI dogfood 依條件跳過。
- 未排除完整 E2E 另行實跑 116 案，唯一紅燈為既有核准豁免 `REQ-PERF-001`：cold-start p95 3,896 ms，高於原 3,000 ms 門檻；產品 budget 與斷言均未放寬。
- 其餘效能案例通過：四工作區串流 frame p95 16.9 ms、renderer CPU 1.2%、working set 181.2 MB；worktree list p95 223 ms、建立 1,158 ms。Spec 與 Standards 獨立複核皆為 0 blocker、0 suggestion。

## v0.26.0（2026-08-10）

依使用者再次確認，完整移除終端機內容／對話導覽軸；不只 Claude／Codex，Agy 與一般 shell 也不再顯示或執行這套功能。

- 對應功能 commit：`b18241e`

### 2026-08-10｜完整移除終端機導覽軸

- `TerminalView` 刪除 xterm buffer 掃描、節點取樣狀態、scroll／resize 更新、點擊跳轉與 `Alt+↑`／`Alt+↓` 攔截，不留隱藏中的背景處理。
- 刪除 `terminalNavigation.ts`、純函式單測、真 PowerShell 導覽 E2E 與整組 `.pd-term-navigation*` 樣式；AI 快捷啟動回歸改為斷言整頁不存在導覽 DOM。
- xterm host 收回原本固定預留的 18 px 左側空間；PTY、5,000 行 scrollback、AI 快捷啟動、尺寸同步與狀態徽章維持不變。
- 版本同步至 v0.26.0，README、內建關於視窗、dogfood 歷程、專案地圖與出貨報告一併更新。

### 驗證

- 修正前真 Electron 回歸可找到 1 個導覽軸；完整移除後 Claude bypass、Codex、Agy 三種快捷終端正常啟動，整頁 `.pd-term-navigation` 為 0。
- TypeScript typecheck、正式 build 與完整序列 Vitest 通過：65 個測試檔、562/562 案全綠；刪除數精確對應原導覽純函式 3 案。
- 真 Electron E2E 共 108 案：105 通過，3 個需要真 Agy／Codex 帳號的 dogfood 案例依既有條件跳過；第 8 shard 初跑有一次檔案連結 Ctrl+點擊時序 flake，單案與完整 shard 重跑皆綠。`REQ-PERF-001` 沿用既有核准豁免。
- 效能回歸維持：四工作區串流 frame p95 16.9 ms、renderer CPU 1.4%、working set 179.9 MB；worktree list p50 232 ms 通過既有 regression guard，報表 p95 461 ms（N=3）高於文字 budget 300 ms，但現行測試契約僅以 p50 守衛，未在本輪擴張修改。

## v0.25.0（2026-08-10）

修正編輯器／終端機標頭 `×` 會移除 panel、讓側欄跟著重新分配尺寸的問題；關閉改為原地隱藏，重新顯示後沿用原本版面與工作狀態。

- 對應功能 commit：`2c371d0`

### 2026-08-10｜標頭關閉維持側欄尺寸

- dockview 預設標頭 `×` 由 Polydesk 接管並導向共用顯隱路徑，不再呼叫 panel remove；側欄、編輯器與終端機的標頭關閉行為與上方版面按鈕一致。
- 隱藏或叫回編輯器／終端機前先記住側欄實際寬高，dockview 完成空間重分配後立即設回，支援使用者自行拖曳停靠後的版面。
- panel 只改 group 可見性，不 dispose React component；編輯器內容與終端機 panel 可原地保留。
- 版本同步至 v0.25.0，README、內建關於視窗、dogfood 歷程與專案地圖一併更新。

### 驗證

- TypeScript typecheck、正式 build 與完整序列 Vitest 通過；66 個測試檔、565/565 案全綠。
- 真 Electron E2E 依 Windows 穩定設定拆成 12 個單 worker shard：109 案中 106 通過，3 個需要真 Agy／Codex 帳號的 dogfood 案例依既有條件跳過；`REQ-PERF-001` 冷啟動案例沿用既有核准豁免，未修改門檻或測試。
- 新增 `layout-close-size` 真 Electron 回歸，修正前重現側欄寬度漂移 49 px；修正後編輯器與終端機標頭 `×` 的隱藏／叫回流程皆維持側欄寬高，panel DOM 原地保留。
- 效能回歸維持門檻內：四工作區串流 frame p95 18.2 ms、renderer CPU 2.3%；worktree 列表載入 p95 179 ms、建立 884 ms。

## v0.24.0（2026-08-08）

依 dogfood 回饋移除 Claude／Codex 專用對話軸；終端機不再讀取兩種工具的對話檔，左側統一回到只依目前 xterm 輸出建立的內容導覽。

- 對應功能 commit：`617db8c`

### 2026-08-08｜移除 Claude／Codex 對話軸

- shared contract、IPC 白名單與 main router 移除 `ai:conversation`；renderer 刪除對話背景輪詢、Claude transcript 定位、Codex session／scrollback 配對及專用訊息節點樣式。
- 刪除 Claude transcript reader、Codex rollout 對話 reader、renderer 配對 helper，以及其單元與專用 Electron 測試；新增安全回歸，禁止 renderer 再取得對話讀取通道。
- Claude／Codex 終端機一律使用既有通用內容導覽，只掃描目前 xterm buffer 的非空邏輯行；`Alt+↑`／`Alt+↓`、點擊跳轉與 5,000 行 scrollback 行為不變。
- `POLYDESK_TERM_ID` 保留給 Claude hook 清理同 terminal 的殘留狀態；AI 快捷啟動、xterm／ConPTY 尺寸同步及工作區狀態徽章不受影響。
- 版本同步至 v0.24.0，README、內建關於視窗、專案地圖與出貨歷程一併更新。

### 驗證

- TypeScript typecheck 與正式 build 通過；目標 Vitest 50 案、Claude／Codex 快捷啟動與內容導覽真 Electron 2 案全綠。
- 全量 Vitest 共 564 案：高併發初跑 563 案通過，既有 `FileWatcher` 事件洪水案例未收到 chokidar 事件；單 worker 先隔離重跑該 suite 7/7 綠，再以同設定完整重跑 564/564 全綠，判定為 Windows watcher 時序 flake，未修改產品碼或測試門檻。
- 全量 Electron E2E 共 109 案：106 通過，3 個需要真 Agy／Codex 帳號的 dogfood 案例依既有條件跳過；本輪未出現剪貼簿環境阻擋，四工作區串流與 worktree 效能門檻亦通過。

## v0.23.0（2026-08-07）

修正 Claude 終端機的對話軸從未真正接手的問題：導覽軸不再把 TUI 重繪殘影逐行畫成密集刻度，辨識為 Claude 後只顯示使用者提問。

### 2026-08-07｜Claude 對話軸辨識修正

- `ClaudeStatusMonitor.terminalTool` 在程序掃描認不出終端機時改採 Claude hook 的 `termId` 綁定。該綁定由 Claude 自己回報，`SessionEnd` 會刪狀態檔、`SessionStart` 會清同 `termId` 殘留，因此比程序樹掃描可靠；忙碌 Windows 上掃描整輪逾時（`scanReliable` 全 false）是常態，先前只靠掃描會讓 AI 對話軸永遠退回一般行導覽。無綁定時仍 fail-closed 回 `null`。
- 對話軸判準移除 alternate buffer 前提。Claude Code 的 Ink TUI 跑在 normal buffer，舊條件恆為 false，`v0.22.0` 的「只顯示使用者提問」在 Claude 上實際從未生效。
- 已辨識為 Claude 但尚未配對到提問時整條軸留白，連 viewport 薄片都不繪製，不退回逐行刻度。
- 對應 e2e 從「切 `?1049h` 進 alternate screen」改為驗證 normal buffer 下接手，並新增 session 結束後交還一般行導覽軌的斷言。

### 驗證

- TypeScript typecheck、正式 build 與全量 Vitest 通過（592 個案例；一次 `SearchService` tmp 目錄 EPERM 為 Windows 檔案鎖 flake，單獨重跑 23 綠）。
- 真 Electron E2E：`terminal-transcript-rail` 與 `terminal-navigation` 全綠；新增 `claude-rail-dogfood`（預設跳過，`POLYDESK_DOGFOOD_CLAUDE_RAIL=1` 啟用）以真 Claude 驗證啟動後對話軸接手且尚未提問時零節點。
- 另以真 hook 綁定＋真 transcript 走完整 main 鏈路手動驗證：軸只呈現單一使用者提問節點，`aria-label` 對應該則原文。
- 全量 E2E 97 通過、4 跳過；12 個剪貼簿案例受驗證機台環境阻擋（`OpenClipboard` 對所有程序回 `ERROR_ACCESS_DENIED`，PowerShell `Set-Clipboard` 同樣失敗），與本次改動無關，待剪貼簿服務恢復後補驗。`perf` 案例單獨重跑通過。

## v0.22.0（2026-08-06）

Claude 與 Codex 的終端機對話軸改為「我的提問索引」：只顯示使用者文字，並以終端機級 session 綁定避免同工作區多個 AI 終端互相串線。

### 2026-08-06｜Claude／Codex 對話軸只顯示使用者提問

- Claude transcript reader 不再建立 assistant 節點；長刻度只代表使用者提問，點擊仍以 `Ctrl+O` 與相對 prompt 次數定位原回合。
- 每個 PTY 在 spawn 前產生 `termId` 並注入子程序環境；Claude hook 把 `termId` 寫回 session 狀態，手動與快捷啟動都能精確綁定目前終端機，同 cwd 的另一個 Claude session 不再被 mtime 猜中。
- Codex reader 只接受 `source=cli`、`originator=codex-tui` 的 `event_msg/user_message`，排除可能含系統注入上下文的 response user、subagent 與 exec rollout；並尊重官方 `CODEX_HOME`。
- Codex 不以同 cwd 最新檔猜 session，而是讓目前 xterm 的 prompt 行唯一反證候選；只有恰好一個 session 能可靠配對時才顯示，點擊與 `Alt+↑／Alt+↓` 都捲到原始提問行。
- AI 程序、terminal 或 session 無法可靠綁定時採 fail-closed 空軸，不回退把模型輸出當一般導覽節點；一般 PowerShell 的內容導覽維持原行為。

### 驗證

- 全量 ship gate 通過：TypeScript typecheck、正式 build、591 個 Vitest 與 109 個非豁免 Electron E2E 全綠；另有 3 個需要真 AI 帳號的 dogfood 案例正常跳過，既有 `REQ-PERF-001` 冷啟動案例依已核准豁免排除。
- 其中 154 個 main／PTY／monitor／terminal Vitest 與 6 個真 Electron 目標旅程直接覆蓋本功能；Codex 另以未替換正式 IPC handler 的程序辨識→rollout→xterm 主鏈路驗證手動啟動。

## v0.21.0（2026-08-06）

SCM 分支管理補上本地／遠端清楚分組與安全刪除完整鏈路；刪除影響範圍、阻擋原因與遠端身分都在操作前後保持明確。

### 2026-08-06｜本地與遠端分支安全刪除

- 分支頁分成可獨立收合的「本地分支」與「遠端分支」，各自顯示數量；每列的 `⋯` 與右鍵共用同一套操作選單，避免兩個入口出現不一致行為。
- 本地刪除固定使用 `git branch -d -- <name>`，沒有 `-D` 強制路徑；目前分支、其他 worktree 使用中的分支與未合併分支會保留，並在選單或錯誤訊息具名說明阻擋原因。
- 遠端刪除固定使用 `git push <remote> --delete <branch>`，確認視窗明示伺服器影響；成功後只刪指定遠端分支，本地同名分支與其他 remote 不受影響。
- shared IPC 新增結構化 `remoteBranches`，main 依實際 remote 清單採最長前綴解析，支援合法的 `team/backend` 斜線 remote，不再由 renderer 拆字串猜 remote。
- Git 原始錯誤在回傳 UI 前會中和 bidi 與 C0 控制字元，再依非法 ref、目前分支、worktree、未合併、認證、網路、逾時、remote 不存在與伺服器拒絕等情況結構化分類；成功後同步刷新分支、snapshot、歷史與 worktree 狀態。

### 驗證與已知豁免

- 全量 ship 驗證通過：TypeScript typecheck、正式 build、574 個 Vitest，以及 110 個非豁免 Electron E2E；Windows 資源敏感案例以單 worker 分成 6 個 Vitest shard 與 12 個 E2E shard，範圍未縮減。
- 審查修正後再通過 32 個 Git／錯誤分類單測與 1 個真 Electron 分支管理 E2E；測試包含真 Git、bare remote、worktree、未合併分支與 `team/backend` remote。
- 既有 `REQ-PERF-001` 冷啟動 `<3s` 在同機多 AI 負載下量得 p95 3159、3335、6437 ms。使用者於 2026-08-06 核准沿用既有效能豁免直接發布；3 秒門檻與測試本身均未修改，ship gate 僅排除這 1 案。
- Windows 真實相依測試的 Vitest 單案例與 hook timeout 由 25 秒放寬為 60 秒，另將既有 ConPTY 自然結束事件輪詢放寬至 30 秒；產品執行與網路 timeout 不變。

## v0.20.0（2026-08-05）

Claude 面板的對話軸：終端機左側導覽軌在自繪畫面的 TUI（claude）底下改以「對話訊息」為節點，補上這類面板一直看不到導覽軌的空白。

### 2026-08-05｜Claude 面板改用對話軸

- 病根：導覽軌以 xterm buffer 的非空白邏輯行建節點，顯示條件是 `buffer 行數 > 可視列數`。claude 一啟動就送 `?1049h` 切 alternate screen 並自繪整個畫面，而 alt buffer 沒有 scrollback、長度恆等於可視列數，條件永遠不成立——不論跑多久、輸出多少，claude 面板的軌上永遠沒有節點（codex、PowerShell 留在 normal buffer 故不受影響）。
- 修法：偵測到 alt buffer 時改換資料源，讀 claude 自己寫的 session transcript（`~/.claude/projects/<slug>/<sessionId>.jsonl`）建節點，節點對齊「訊息」而非終端機行。長節點＝使用者提問、短節點＝Claude 回覆，滑過顯示該則摘要。
- 綁定方式刻意零侵入：不改使用者的啟動指令，以工作區 cwd 推出 slug 目錄、取 mtime 最新的 session 檔；jsonl 為 append-only，故只讀新增位元組並沿用既有節點，長對話不會每次重解析數 MB，尾端半行留到寫完才計入。
- 節點語意：同一回合內連續的多則 assistant 發言摺疊為一個節點——定位只能跳到 user prompt，展開成多個節點會是假的可點性。sidechain（subagent）、工具回填、`isMeta` 補註與 slash 指令 stdout 都不計入。
- 跳轉：alt buffer 拿不到絕對行號，改送 `Ctrl+O` 開啟 claude 的對話檢視（停在最新）再送 N 次 `{` 往回跳到該則提問；刻意不送 Enter，萬一使用者當下已停在對話檢視，最壞只是輸入框多出幾個字元、不會執行任何東西。
- 離開 TUI 回到一般 shell 時立即交還原本的逐行導覽軌；找不到 session 檔的 alt-screen TUI（vim 等）維持原本的空軌，不誤標。

## v0.19.0（2026-08-04）

worktree 移除相容性修正：舊版或手動以一般工作區加入的既有 worktree，現在可正常移出列表或連同資料夾刪除；操作失敗也會留下明確提示。

- 對應功能 commit：`25f1228`

### 2026-08-04｜修正舊 worktree 兩種移除都沒有反應

- 病根：SCM 列表會依 Git 路徑認出已納管 worktree，但移除 handler 只接受 state 內含 `worktree.mainPath` 的工作區；舊版或手動以一般工作區加入的資料沒有這段 metadata，因此主程序直接回「非 worktree 工作區」。
- 修法：連同刪除前改由 `git worktree list` 的真實登記解析待刪路徑與主工作樹，並拒絕主工作樹或未登記資料夾；僅移出列表仍只 teardown 與 delist，不碰磁碟資料。
- 錯誤回饋：兩種移除都會檢查 IPC 結果與例外；失敗後停止重新整理，避免剛寫入的錯誤立刻被清空而看似沒反應。
- 影響範圍：SCM `worktree` 分頁、工作區生命週期 teardown 與 Git worktree remove；不修改既有 worktree 內容，也不改變 dirty 二段確認及 `--force` 規則。
- 驗證：worktree 單元測試 14 案、typecheck、正式 build、真 Electron worktree E2E 4 案全綠；全套 Vitest 552 案初跑有 2 個 Windows 併發／watcher 偶發失敗，隔離重跑 10 案全綠，其餘 550 案初跑通過。

## v0.18.0（2026-07-31）

終端機內容導覽與四工作區效能優化：長篇 Claude／Codex 輸出可逐句跳轉，多個背景終端持續串流時也降低 Polydesk renderer 的重複成本。

- 對應功能 commit：`1d04569`

### 2026-07-31｜新增逐句導覽軌並收斂背景終端成本

- 導覽：每個終端左側依非空邏輯行建立可點擊節點，自動換行延續列不重複；支援文字預覽、目前位置與可視區標示，以及 `Alt+↑`／`Alt+↓` 相鄰跳轉。長輸出最多均勻取樣 220 個視覺節點，既有 5,000 行 scrollback 保持不變。
- 病根：每個 `TerminalView` 原先都註冊全域 PTY data listener，四個終端會重複接收並篩選彼此事件；不可見終端仍持有 WebGL，main process 也一律以 16ms flush 高頻推送，AI CLI 高輸出時會放大 IPC、解析與 GPU 成本。
- 效能：renderer 改由單一 dispatcher 依 `termId` 分流；不可見終端釋放 WebGL，純背景 PTY 改為 100ms 合併輸出，鍵盤輸入後 250ms 內的回應則用 4ms 互動優先 flush；切回前景時立即補送並重新 fit。輸出不丟棄，shell 與 AI CLI 程序亦不會被暫停。
- SCM 病根：狀態列、活動列與 SCM 面板只合併完全同時的 snapshot，錯開 300ms 仍會重掃；歷史／分支 effect 依賴整份 `changes`，AI 每次改檔都可能附帶重跑 `git log`／branch list；大量變更則一次建立所有 React 列。
- SCM 修法：快照保留 600ms 短時共用並由檔案事件／Git 操作明確失效，同一批事件只遞增一次世代；歷史與分支只在 HEAD、branch 或使用者操作後重讀；變更清單每批渲染 200 項，背景 Git 探測由 5 秒放寬到 10 秒並保留 focus 即時喚醒。
- Git 線圖改為走訪所有本地與 remote-tracking refs；手動重新整理完成 fetch 後，尚未 pull 的同事 push 版本也會顯示遠端分支徽章，不會自動 merge 或改動工作樹。
- 無障礙：節點為可聚焦按鈕，提供句子預覽、目前節點狀態與清楚 focus ring；遵循 `prefers-reduced-motion`，不以動畫作為唯一狀態提示。
- 驗證：導覽、dispatcher、快照世代與 PtyManager 單元測試、typecheck、build，以及新增／受影響的真 Electron E2E 全綠；四工作區各自持續高速輸出的壓測量得 frame p95 19.7ms、renderer CPU 3.6%，低於 50ms／25% budget；20 鍵 steady-state 三輪 p95 為 22／21／21ms，最終隔離重跑為 25ms；SCM 以 600 個真變更驗證初始 DOM 只有 200 列，四波檔案事件最多 4 次 snapshot 且額外 `git log` 為 0。既有冷啟動 `<3s` 門檻在目前多個 AI 程序同時運作的機器上重跑為 3.45–4.08s，列為後續獨立啟動路徑優化，不影響本次四工作區穩態與 SCM 修正。

## v0.17.0（2026-07-27）

第三方軟體剪貼簿相容修正：圖片即使被包裝成無路徑、通用 MIME 的虛擬檔案，仍可在 Polydesk 檔案總管貼入。

### 2026-07-27｜支援非標準 MIME 的虛擬圖片檔

- 確認：圖片貼上链路使用 Electron `clipboard.readImage()` 與 Node 檔案 API，沒有啟動外部程式或以程式名查找執行檔；第三方軟體重排系統 `PATH` 不會影響此功能。
- 病根：部分軟體不會在 paste event 公告 `image/*`，而是提供 `Files` 與 `application/octet-stream`（或空 MIME）的無磁碟路徑虛擬 File。v0.16.0 只在偵測到 image MIME 時啟動 bitmap fallback，所以這類剪貼簿會誤報無法取得檔案路徑。
- 修法：只要 paste event 有 `Files` 但取不到任何可用磁碟路徑，也會交由 main process 嘗試讀取剪貼簿 bitmap 並沿用既有 PNG 安全落檔流程；實體檔案與純文字貼上行為不變。
- 驗證：typecheck、差異格式檢查與正式 build 通過；真 Electron Explorer E2E 4 案全綠，新案重現 `Files` + `application/octet-stream` + 無路徑虛擬圖片，確認仍會讀取系統 bitmap 並建立 PNG。

## v0.16.0（2026-07-27）

剪貼簿圖片貼上支援：從截圖工具、瀏覽器或通訊軟體複製圖片後，可直接在 Polydesk 檔案總管按 `Ctrl+V` 建立 PNG。

### 2026-07-27｜支援無磁碟路徑的剪貼簿圖片

- 病根：既有檔案總管貼上功能只處理 Windows 檔案總管複製的實體檔案，依賴 `webUtils.getPathForFile()` 取得磁碟路徑；截圖工具、瀏覽器與通訊軟體提供的是剪貼簿 bitmap，雖然 paste event 可能帶 `Files`／`image/png`，但產生的虛擬 File 沒有磁碟路徑，因此舊程式只會顯示「無法取得貼上檔案的路徑」。
- 修法：Explorer 現在區分實體檔案與無路徑 bitmap；前者維持既有 `importFiles`，後者經固定白名單 `fs:importClipboardImage` 交 main process 直接讀取系統剪貼簿、轉成 PNG，並寫入目前選取資料夾或工作區根目錄。
- 命名與安全：預設檔名為 `貼上圖片.png`，衝突時沿用 `copy`／`copy 2` 自動改名，不覆蓋既有檔案；圖片 bytes 不經 renderer 傳遞，目的地仍通過工作區 containment，空圖片、越界目的地與超過 20MB 的 PNG 會拒絕。
- 驗證：fileService 單元測試 32 案、typecheck、差異格式檢查與正式 build 全綠；真 Electron E2E 3 案實際將 1×1 PNG 寫入 Windows 剪貼簿後按 `Ctrl+V`，確認落檔、檔案樹更新與圖片預覽成功，既有外部檔案貼上兩案亦通過。

## v0.15.0（2026-07-27）

AI 執行狀態 PATH 相容性修正：Windows PATH 被其他軟體重排後，工作區列仍能顯示 Claude、Codex 與 Agy 狀態標籤。

### 2026-07-27｜修正新版可開終端機但 AI 執行標籤消失

- 病根：v0.13.0 已把終端機 shell 改成由 `SystemRoot` 組絕對路徑，因此受影響電腦可以重新建立終端機；但 AI 狀態監控仍以裸名稱啟動 `wmic` 與 `powershell.exe`。Windows 11 缺少 WMIC 且 PATH 又無法解析 PowerShell 時，程序掃描兩條路徑都失敗，Claude／Codex／Agy 的 PID 快取保持空白，工作區列便沒有任何狀態標籤。
- 修法：AI 程序掃描器現在以不分大小寫的 `SystemRoot`／`windir` 組出 WMIC 與 Windows PowerShell 絕對路徑；即使 PATH 只剩第三方軟體目錄，WMIC 不可用時仍可經系統 PowerShell 的 CIM 掃描取得三種 AI 程序的 parent shell PID。
- 一致性：終端機建立與狀態監控都不再依賴 PATH 尋找 Windows 內建工具；既有 process gate、工作區 cwd 歸戶、狀態事件與 fail-open 快取策略維持不變。
- 驗證：程序掃描、狀態監控與版本同步單元測試 17 案、typecheck、差異格式檢查與正式 build 全綠；回歸測試模擬 PATH 只有 `C:\\Tools`、WMIC 不可用，確認 fallback 仍以 `D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` 執行並正確解析 Claude／Codex／Agy PID；既有 PATH 真 Electron E2E 2 案亦通過。

## v0.14.0（2026-07-27）

Claude Code 工具輸出連結修正：`Read(...)` 顯示的檔案路徑現在可按住 Ctrl 點擊開啟，含行數範圍時會直接跳到起始行。

### 2026-07-27｜修正 Claude Read 檔案連結無法開啟

- 病根：既有終端檔案 matcher 只辨識獨立路徑 token；Claude Code 實際輸出為 `Read(C:\path\file.md)` 或 `Read(C:\path\file.md · lines 1-60)`，`Read(` 前綴與行數後綴讓整段無法成為合法路徑，因此 Ctrl+左鍵找不到可啟用的 match。
- 修法：在通用 token 解析前新增工具呼叫格式解析，只把括號內真正路徑映射成 xterm 連結；支援 Windows 絕對／相對路徑與空白，`lines N-M` 會轉成編輯器起始行定位，工具名稱、括號與行數後綴不會送進 main process。
- 去重與安全：特殊格式和通用 parser 以完整文字區間去重，避免同一段生成兩條重疊連結；檔案存在性、工作區 containment、外部檔確認與危險副檔名封鎖仍由既有 main process 安全鏈路執行。
- 驗證：檔案連結單元測試 7 案、typecheck、正式 build 全綠；真 Electron E2E 實際 hover 並 Ctrl+點擊 `Read(system/health log.md · lines 2-3)`，確認 Monaco 開檔並跳到第 2 行，既有工作區內定位與工作區外安全案例亦通過。

## v0.13.0（2026-07-24）

Windows 終端機啟動相容性修正：安裝其他軟體導致 PATH 重排後，PowerShell、CMD 與 WSL 仍可正常建立；失敗時也會顯示可判讀的原因。

### 2026-07-24｜修正 Sunlike365 安裝後終端機無法開啟

- 病根：Polydesk 原本把 `powershell.exe`、`cmd.exe` 等裸名稱交給 `node-pty 1.1.0`；其 Windows PATH parser 會漏掉沒有尾分號的最後一段。Sunlike365 安裝後若把 `System32` 或 Windows PowerShell 路徑排到最後，外部 shell 仍可正常開啟，但 Polydesk 會回報 `File not found`。
- 修法：Windows PowerShell、CMD、WSL 改由 `SystemRoot` 組出絕對執行檔路徑，不再依賴 node-pty 查找；PowerShell 7 與 Git Bash 保留安裝位置探測，並使用會完整檢查最後一段的安全 PATH parser，所有合法 shell 最終都以絕對路徑啟動。
- 錯誤回報：`pty:create` 新增 `invalid-shell`、`no-workspace`、`shell-not-found`、`spawn-failed` 結構化結果；新增與崩潰重啟失敗時，終端機面板會顯示可關閉的就地提示與錯誤代碼，不再靜默吞掉例外。
- 安全邊界：renderer 仍只能傳固定 `ShellKind`，不能指定任意執行檔或參數；終端機環境清洗、工作區 cwd 驗證與 ConPTY 安全策略維持不變。
- 驗證：typecheck、正式 build、PTY／環境單元測試 29 案，以及真 Electron E2E 2 案全綠；E2E 直接以 `C:\\Sunlike365;C:\\Windows\\System32` 且無尾分號的 PATH 啟動，確認 PowerShell 可建立，並另驗證缺少 shell 時會顯示 `shell-not-found`。

## v0.12.0（2026-07-24）

終端機網址外開修正：純文字 HTTP／HTTPS 與 OSC 8 超連結現在可安全交給系統預設瀏覽器，不再只能顯示、無法點擊。

### 2026-07-24｜支援終端機網址 Ctrl+點擊外開

- 病根：終端機只註冊檔案路徑 LinkProvider，而檔案解析器又明確排除所有 `scheme://`；main 雖有 `shell.openExternal`，但沒有任何終端點擊流程會送出網址，因此 `http://localhost:3000` 從未成為可啟用連結。
- 修法：新增獨立的終端網址解析器與 xterm 格位換算，支援純文字 HTTP／HTTPS 及 OSC 8；沿用 `Ctrl+左鍵` 手勢與 host capture，避免一般點擊干擾選字或 Claude／Codex 等 TUI 滑鼠操作，也避開 WebGL／selection 組合下 `link.activate` 偶發未觸發。
- 安全邊界：renderer 先驗證協定、控制字元、長度與內嵌帳密，再經固定白名單 IPC 送 main 複驗；只有合法 HTTP／HTTPS 會交給 `shell.openExternal`，`javascript:`、`file:`、`data:` 與非標準三斜線輸入維持封鎖。既有 BrowserWindow 外開攔截也改用同一條驗證規則。
- 中文、全形字與 emoji 出現在網址前方時，連結範圍會依 xterm 實際格位換算；句尾中英文標點不會被誤帶進網址，URL 內成對括號則會保留。
- 驗證：網址／安全選項單元測試 12 案、typecheck、正式 build，以及真 Electron 網址外開、工作區內檔案定位、工作區外檔案確認與危險腳本封鎖 E2E 共 3 案全綠。

## v0.11.0（2026-07-23）

編輯器外部同步與分頁管理批次：AI 或其他工具改寫已開啟檔案後會自動對帳與更新，分頁右鍵可安全批次關閉目前工作區的檔案。

### 2026-07-23｜已開檔案自動同步與右鍵批次關閉

- 病根：編輯器雖已訂閱精準的 `fs:change`，但 AI 短時間修改大量檔案時，FileWatcher 會為避免事件洪水改發 `path=''` 的工作區層級訊號；舊程式把這類事件當成不存在的分頁鍵而忽略。檔案讀取也未必先啟動 watcher，因此部分開檔路徑只能關閉再開才看到磁碟新版。
- 修法：每個文字分頁保存最後一次磁碟內容快照，精準事件與工作區層級事件都重新讀取並比對；乾淨分頁只有在內容確實改變時才更新，避免重設 undo stack。每分頁讀取序號會丟棄晚回的舊結果，且文字、圖片、Word、試算表讀取前都先確保工作區 watcher 已建立。
- 衝突保護：有未存檔內容時只記錄磁碟已變動，不直接覆蓋 Monaco model；由於對帳讀取會刷新主程序的 mtime 指紋，renderer 另以 `diskChanged` 在存檔前強制保留「載入磁碟版本／保留我的編輯」選擇，不讓自動同步繞過 lost-update 防護。
- 分頁操作比照 VS Code 的群組概念新增「關閉、關閉其他、關閉全部」右鍵選單；批次範圍限所點分頁的工作區，逐一沿用既有未存檔確認，取消會立即中止剩餘項目，不影響其他工作區保留的分頁。
- 驗證：typecheck、正式 build、FileWatcher／fileService 單元測試 42 案，以及外部精準更新、工作區層級對帳、dirty 批次取消／捨棄、跨工作區隔離與既有衝突流程的真 Electron E2E 4 案全綠。

## v0.10.0（2026-07-23）

worktree AI 狀態顯示修正：worktree 內執行 Claude、Codex 或 Agy 時，工作區列現在會正常顯示工具與狀態。

### 2026-07-23｜worktree 保留 AI 執行狀態標籤

- 病根：工作區列把「worktree 類型圖示」與 `ClaudeStatusBadge` 寫成互斥條件；一般工作區會掛載 AI 狀態元件，但 worktree 只渲染 `⎇`，即使監控已正確把事件歸戶到 worktree，畫面也沒有元件可以呈現。
- 修法：`⎇` 只負責描述工作區類型，所有有效工作區都獨立掛載相同的 Claude／Codex／Agy 狀態徽章；資料夾遺失的工作區仍不訂閱狀態。
- 狀態監控與歸戶規則不變：session cwd 仍採最長工作區路徑匹配，所以主工作樹與各 worktree 會各自顯示，不會互相污染。
- 驗證：worktree 與狀態歸戶單元測試 15 案、typecheck、正式 build，以及真 Git／Electron 的 worktree 建立、納管與 AI 徽章掛載 E2E 1 案全綠。

## v0.9.0（2026-07-23）

終端檔案連結可靠性批次：修正中文與 emoji 造成連結裝飾、點擊命中錯位，並降低一般終端文字被誤判為路徑的情況。

### 2026-07-23｜修正終端檔案連結錯位與誤判

- 病根：路徑解析器回傳的是 JavaScript 字串索引，但 xterm 的連結範圍與滑鼠命中使用終端格位；中文字、全形字與 emoji 會佔兩格，出現在路徑前方時，底線與 Ctrl+點擊區域便會向左偏移，畫面看似有連結卻打不開。
- 修法：逐格讀取 xterm buffer 的字元與寬度，把解析結果換算為實際起訖格位；LinkProvider 裝飾與 host capture 點擊共用同一組格位結果，不再各自用字串索引猜位置。
- 相對路徑判定同步收緊：未以 `./`、`../` 開頭的相對 token 必須具備檔案副檔名，避免 `N/A`、`workflow/subagent`、`API/資料表` 等說明文字被畫成無法開啟的假連結；Windows 絕對路徑、家目錄、明示相對路徑、行欄定位與含空白引號路徑維持支援。
- 驗證：路徑解析單元測試 5 案、typecheck、正式 build，以及含「中文＋emoji＋相對路徑＋行欄」的真 Electron Ctrl+點擊 E2E 與工作區外安全開啟 E2E 共 2 案全綠。

## v0.8.0（2026-07-22）

快捷啟動首屏穩定批次：修正 Claude bypass 偶發歡迎橫幅殘影——啟動命令改等終端尺寸靜置穩定（含字型就緒）後才送出。

### 2026-07-22｜修正 Claude bypass 偶發首屏殘影（尺寸穩定窗）

- 病根：v0.7.0 之後啟動命令已等「首次 resize 確認」，但掛載後零點幾秒內版面仍可能再變一次（版面收斂尾巴、字型載入改變格寬、resize 失敗 350ms 補送）；遲到的 resize 撞上 Claude 繪製靜態歡迎橫幅，橫幅便以舊寬度定格成殘影（動態輸入區會重畫、靜態區不會）。
- 修法：`TerminalView` 把啟動閘門從「首次確認」升級為「穩定窗」——尺寸確認套用後靜置 250ms 無再變動、且字型 `fonts.load` 已決議，才通知快捷啟動器送出命令；期間任何新尺寸確認重新計時，同尺寸重複確認不重置倒數，倒數到點再核對當下欄列。
- 快捷啟動因此約慢 0.25 秒；手動終端機、後續版面調整與既有 resize 失敗重試、輸出自癒行為不變。
- 驗證：typecheck、完整 Vitest、正式 build，AI launch 真 Electron E2E 補「命令送出後短窗內欄數不得再變」回歸全綠。

## v0.7.0（2026-07-22）

終端尺寸同步可靠性批次：修正快捷啟動與版面切換時，IPC 已回覆但 ConPTY 實際 resize 失敗，導致 Claude 等 TUI 仍按舊欄寬繪製並被右側裁切。

### 2026-07-22｜修正 Claude 歡迎畫面偶發沿用舊欄寬

- `pty:resize` 回應新增實際套用狀態與目前欄列；main process 只有在 node-pty resize 成功後才回報 `applied: true`，不再把捕捉到的 ConPTY 例外包成假成功。
- AI 快捷啟動會逐一核對 xterm 要求的欄列與 ConPTY 已套用欄列，完全一致才送出 Claude／Codex／Agy 命令；首次失敗會延後重試，不讓 TUI 在錯誤尺寸下啟動。
- 終端機啟動後若工作區列、側欄、編輯器或最大化切換造成 resize 暫時失敗，即使畫面沒有後續輸出也會主動重試，避免靜止的歡迎畫面永久卡在舊欄寬。
- 回歸測試新增 resize 失敗回應契約，以及假 Claude 從真實 PTY 回報欄數並與 xterm 對賬；PtyManager 21 案、typecheck、正式 build 與 AI launch Electron E2E 皆通過。

## v0.6.0（2026-07-21）

AI CLI 快捷啟動批次：終端機面板直接提供 Claude bypass、Codex、Agy 三個入口，不必先新增終端機再手動輸入啟動文字。

### 2026-07-22｜加速 SCM 讀取與分支切換

- SCM 改用單次 `git:snapshot` 同時取得分支狀態與變更清單；活動列、底部狀態列與 SCM 面板的同工作區並行讀取再以 single-flight 合併，不再各自把重複的 `git status` 塞進序列佇列。
- 自動／手動 fetch 直接沿用最新快照判斷 remote，不再為判斷是否需要 fetch 額外掃描一次工作樹；背景狀態探測取得的快照也直接更新畫面，不再偵測到變動後重查。
- 分支清單由三個 Git 程序合併成單一 `for-each-ref`，一次取得本地、遠端與目前分支；成功 checkout 後直接以新快照更新目前分支，不再追加整份 branch list 查詢。
- 實測問題工作區只有 292 個追蹤檔案，但單次 Git 程序在目前 Windows 環境仍需約 1–4 秒，因此本修正以減少程序數與佇列等待為主，不透過忽略 `.flow` 等變更犧牲正確性。
- 驗證包含 snapshot／single-flight／branch list 指令數回歸、完整 Vitest 60 檔 525 案、typecheck、正式 build，以及真 Electron 的 SCM 徽章與 dirty／untracked 分支切換共 5 案。

### 2026-07-22｜終端機檔案路徑可直接開啟

- 終端機輸出的 Windows 絕對路徑、`~\...`、工作區相對路徑及 `path:line:column` 現在會顯示為可互動連結；按住 `Ctrl` 點擊後，工作區內檔案會在 Polydesk 編輯器開啟並跳到指定行欄。
- Claude 等工具產生在工作區外的截圖或一般檔案，會先由主程序顯示完整路徑並要求確認，確認後才交給 Windows 預設程式；取消為預設選項。
- 外部連結只接受既有一般檔案，並封鎖執行檔、腳本、安裝包、捷徑、UNC／裝置路徑與 NTFS alternate data stream；renderer 仍只取得固定白名單 IPC，不暴露 Node 或原始 `ipcRenderer`。
- 新增路徑解析單元測試、主程序 containment／危險類型測試及真 Electron E2E；另回歸終端剪貼簿、SIGINT、OSC52、右鍵 TUI 與多終端管理共 13 案。

### 2026-07-22｜修正快捷啟動 Claude 首屏跑版

- 修正點擊 `Claude bypass` 時，Claude 先以 ConPTY 預設 `80x24` 排版、隨後才切換到面板實際尺寸，造成歡迎畫面與提示區塊橫向錯位；手動輸入因終端早已完成 fit，故不會出現同樣問題。
- Claude／Codex／Agy 快捷命令現在一律等 xterm 完成首次有效 fit，且 PTY resize IPC 完成後才送出；一般手動建立終端機與後續尺寸自癒流程不變。
- 更新真 Electron／PowerShell E2E，確認三個快捷終端機皆先進入「首次尺寸已同步」狀態才收到命令；另回歸尺寸自癒、底列可視性與裁切共 5 案。

### 2026-07-21｜終端機 AI CLI 一鍵啟動

- 點擊任一快捷按鈕會沿用目前選定的 shell 建立獨立終端機，自動命名為對應工具，並送出 `claude --dangerously-skip-permissions`、`codex` 或 `agy`。
- 啟動命令會等待 TerminalView 掛載、開始接收 PTY 資料並完成首次有效尺寸同步後才送出，避免初始輸出遺失或 TUI 先按預設 `80x24` 排版而跑版。
- Claude 按鈕明確標示 `bypass` 並使用警示色與風險說明；此模式略過所有權限確認，只適合完全信任的工作區。
- 新增真實 Electron／PowerShell E2E：以隔離暫存 PATH 的假 CLI 驗證三個按鈕、終端命名、真 PTY 命令執行與 Claude bypass 參數；既有終端管理 5 案亦全數通過。

## v0.5.0（2026-07-20）

GitHub 私有倉庫 Clone 批次：已有 `gh` 登入狀態時直接沿用帳號權限；未登入時提供瀏覽器登入並自動重試，不再只顯示 Git Credential Manager／SSH 的泛用錯誤。

### 2026-07-20｜GitHub 私有 Repository 登入與 Clone

- Clone GitHub HTTPS URL 前會檢查 GitHub CLI 登入狀態；已登入時改由 `gh repo clone` 使用帳號權限，並關閉 fork 自動新增 upstream，保持原本 `git clone` 行為。
- 未登入或未安裝 `gh` 時仍先以原生 Git Clone，確保公開倉庫不被強迫登入；只有 GitHub 認證失敗時才顯示「使用瀏覽器登入 GitHub 並重試」。
- 登入採 `gh auth login --web --clipboard` 官方 device flow，一次性 code 自動複製到剪貼簿，Token 由系統憑證庫保管，Polydesk 不讀取、不儲存，也不把憑證放進 URL 或程序參數。
- 新增 GitHub URL 分流、既有登入 Clone、瀏覽器登入參數與缺少權限分類回歸測試；typecheck、517 案 Vitest、正式 build 與工作區 E2E 4 案通過。

## v0.4.0（2026-07-15）

未拉取可視化批次：遠端有新 commit 不再無感——SCM 以事件驅動 fetch（⟳ 重新整理與切工作區觸發、不背景輪詢）更新遠端狀態，同步列與 pull 鈕出現「↓N 未拉取」數字提示。v0.4.0 tag 打在本版收尾提交。

### 2026-07-16｜終端機持續輸出自癒與編輯器自動換行

- `7e7bdd7` 補強 Claude workflow 長時間維持焦點時的終端尺寸同步：輸出期間節流重送 xterm 實際列數，短促輸出也以 trailing 校正補做，避免底部任務區畫到可視範圍外。
- Monaco 編輯器改為依目前視窗寬度自動換行，並採用進階中英文分行規則；縮窄視窗或調整面板後不再需要水平捲動才能讀完整行。
- 修正使用 dockview 分頁的 × 關閉整個編輯器後，第一次從側欄點檔只會重建空面板、必須再點一次才開檔；editor bus 現在會保留請求並在 EditorGroup 掛載後補送一次。
- 新增根目錄 `AGENTS.md` 貢獻指南，並將「驗證後先更新 CHANGELOG／README，再 commit、push、打包與核對 SHA-256」定為固定交付流程，避免功能、文件與 portable 產物版本脫節。

### 2026-07-15｜未拉取數字提示與事件驅動 fetch

- 未拉取提示（PE-4）：同步列 behind>0 顯示「↓N 未拉取」強調字、pull 鈕右上角數字角標（與未推送同款）；數字來源是 `git fetch` 後的 remote-tracking ref——fetch 只更新遠端狀態，不動工作樹、不自動合併。
- 事件驅動 fetch：按 ⟳ 重新整理順便取回（本地刷新先行、不等網路）；切工作區自動取回（同工作區 60 秒冷卻，連切不狂觸網）。拍板不做背景定時輪詢——平常零觸網（VS Code 預設也關 autofetch，同一派）。
- 取回失敗（離線／認證）不跳錯誤橫幅：自動路徑靜默、手動路徑於同步列下方顯示小字提示，成功即清。

## v0.3.0（2026-07-15）

發佈到 GitHub 與 push 體驗批次：GitHub 還沒建 repo 也能從 Polydesk 一鍵發佈（VS Code「Publish to GitHub」同款體驗、以 gh CLI 實作故 app 不碰 token）。v0.3.0 tag 打在本版收尾提交。

### 2026-07-15｜發佈到 GitHub 與 push 智慧補救

- 發佈到 GitHub（DF-12）：SCM 同步列偵測「沒有 remote」時顯示「發佈」——對話框選名稱與公開／私有後，gh 建 repository、設 origin、推送一氣呵成；gh 未裝／未登入／名稱已存在皆給人話引導。
- push 智慧補救：新分支沒 upstream 自動改跑 `push -u`（不再噴 fatal 原文）；失敗分類為認證／網路／逾時／無 remote／遠端 repo 不存在，SCM 錯誤區給對應指引。

## v0.2.0（2026-07-15）

第二功能批次：Git 工作流（Clone、外部狀態同步）、AI 狀態整合（Codex／Agy）、跨終端複製、終端機輸出跟捲自癒，以及版本可視化（「關於」視窗＋狀態列版本＋本檔版本分節）。v0.2.0 tag 打在本版收尾提交。

### 2026-07-15｜終端機輸出跟捲自癒與版本可視化

- `1b28bb3` 修正 claude 展開 Shell details 後底部被吃掉：xterm 6 孤兒 `isUserScrolling` 旗標會把大量輸出時的 viewport 凍在原地，TerminalView 加自癒不變量「寫入前在底部 ⇒ 寫入後仍在底部」（DF-11）。
- 版本可視化（PE-3）：版本跳 0.2.0；「說明 → 關於 Polydesk」顯示版本與近版重點、狀態列右下常駐版本號；`releaseNotes.ts` 單測擋版本不同步。

### 2026-07-14｜Git 工作流、AI 狀態與跨終端操作

- `4cc6b84` 修正 Monaco 貼上焦點與 `Ctrl/Cmd+V` 攔截，並在 SCM 顯示目前工作區的未提交檔案數。
- `0d7be5f` 調整歷史列伸縮規則，避免長 commit 主旨壓縮徽章；同時依額度週期正確標示 Codex 用量。
- `f4d2b86` 整合 Agy commit 訊息引擎、程序與日誌解析，補齊 Codex／Agy 執行中、待確認、已停止狀態及總覽聚合。
- `d0d2231` 讓終端機有選取文字時可用一般 `Ctrl/Cmd+C` 複製到另一個終端機，未選取時仍保留 SIGINT。
- `1013c23` 新增 HTTPS／SSH Clone Git Repository，完成後自動納管並開啟工作區，並補上路徑、認證、網路與逾時錯誤分類。
- `2ba1d69` SCM 改以低頻 status-only 探測 `HEAD`、分支及 ahead／behind，外部 commit 或 push 後可自動刷新；遠端 ref 改為固定寬度雲端圖示並保留 tooltip／aria 名稱。
- `84e9684` 補齊 README、DF-10 與本更新旅程的文件入口。

### 2026-07-11｜Git 歷史徽章去重

- `88aa77e` 過濾 `<remote>/HEAD` 符號 ref，避免遠端預設分支在歷史面板顯示兩顆內容重複的徽章。

### 2026-07-10｜編輯器叫回與版面落檔

- `aa244d0` 硬化從側欄或 SCM 開檔時的編輯器叫回鏈：隔離 bus listener 錯誤、重新顯示隱藏面板、切到正確 dock tab，並涵蓋 diff 分頁。
- `b02723a` 關窗與退出前同步保存當下 dockview 狀態，修正快速切換面板後立即離開導致版面設定遺失。

### 2026-07-09｜拖放匯入與終端機自癒

- `dcb5a75` 找到 Claude TUI 右鍵偶發雙貼的根因，阻擋右鍵滑鼠回報進入 PTY，只保留一次實際貼上。
- `d198eb3` 支援從 Windows 檔案總管把檔案或資料夾拖入 Explorer，依游標位置匯入工作區並處理重名。
- `04b83c4` 建立 PTY 與 xterm 尺寸自癒同步，resize 失敗可重試，修正 Claude 展開內容時底部輸入區被裁掉。

### 2026-07-08｜拖曳路徑、剪貼簿與完整退出

- `927f7a3` 支援從 Explorer 或作業系統拖檔到終端機，自動依 PowerShell、cmd、Git Bash、WSL 產生安全引用的絕對路徑。
- `d44e166` 修正 Monaco 複製／貼上受權限策略與缺少 product service 影響而失效，僅對自家主視窗開放必要剪貼簿能力。
- `281e019` 重做應用程式退出流程：等待 PTY／LSP／watcher teardown，必要時顯示執行中程序確認，避免關窗後殘留整棵程序樹。

### 2026-07-07｜Windows 通知、共用剪貼簿與圖片預覽

- `280fc72` 設定 Windows AUMID 並保留通知物件引用，改善點擊通知回到 Polydesk 的可靠性。
- `1b01e21` Explorer 複製路徑與 SCM 複製雜湊／訊息統一改走 Electron clipboard IPC，修正瀏覽器剪貼簿權限被拒後靜默失效。
- `38bb38d` 為終端機右鍵貼上增加 300ms 防抖，避免裝置重複觸發或連點造成雙貼。
- `20c23fe` 新增 PNG、JPG、GIF、WebP、BMP、ICO、SVG 唯讀圖片預覽，提供符合視窗／實際大小切換與檔案資訊。

### 2026-07-06｜搜尋、文件預覽與 Git ref

- `6bf103a`、`d953b09` 修正多終端機拖曳雙向排序、拖曳來源、Escape 取消改名及 rail splitter 的動態 aria 數值。
- `a6ac067` 在 Git 線圖標示本地與遠端分支位置，形成接近 VS Code 的 ref 徽章體驗。
- `0818a91` 將打包後 ripgrep 路徑轉到 `app.asar.unpacked`，修正正式包搜尋永遠回空。
- `5c2cd69` 搜尋面板新增檔名群組，內容命中可直接跳行並反白片段。
- `c680aa8` 新增 DOCX／DOC 唯讀預覽：DOCX 保留語意 HTML 與圖片、舊 DOC 顯示純文字，並可交給系統程式開啟。
- `56f4c0e` 編輯器分頁依工作區隔離，切換工作區不再混雜，切回時還原最後聚焦分頁。
- `c348a94`、`4dfd0ca` 更新 Git 與工作區 E2E selector／前提，讓測試符合新版 UI 並維持決定性。

### 2026-07-03｜終端體驗、工作區切換與 SCM 回饋

- `12b876d` 修正終端機 keycap 項目編號顯示成數字加空框。
- `35e2c84` 修正點擊工作區列的 Claude／Codex 徽章區無法切換工作區。
- `471ebac` 為快速工作區切換加入載入防抖與 stale 取消，避免畫面卡住或舊請求覆蓋新狀態。
- `2da6306` 更新 Git commit 操作測試中已過時的 active branch selector。
- `bc199f5` 為淺色主題調整 ANSI 色盤，並打包四款開源等寬字型。
- `96034a2` 醒目顯示未推 commit，並在狀態列常駐目前分支。
- `8571261` 未納管 worktree 的「切換到此」改為就地詢問加入，不再中斷流程。
- `7e75502` 提升淺色／暖色主題彈窗標題的辨識度。
- `2e7a772` 桌面通知可點擊回到 Polydesk 並切換到對應工作區。
- `12d6780` 多終端機支援拖曳排序、顯示／隱藏而不關閉，以及自訂名稱。
- `961fb45` SCM 讀取與載入期間加入動態回饋。
- `73bd2c1` 為工作區欄 splitter 補上 `aria-valuenow`、`aria-valuemin` 與 `aria-valuemax`。

### 2026-07-02｜品牌、Git Worktree 第二迭代與終端相容性

- `b3537bc` 全站換成 Polydesk 疊層星芒品牌圖示。
- `be100df` 讓終端機底色填滿 pane，已開啟終端機也會即時跟隨主題。
- `474e372` 為 Explorer 刪除單元測試注入資源回收桶 stub，修正刪除行為改版後長期失敗的測試。
- `65b1ce7` 凍結 Git Worktree 第二迭代規格與分波設計。
- `450e89a` 建立 worktree typed IPC、GitService 操作、路徑／信任硬化及持久化 schema v2。
- `812195f` 完成建立 worktree 流程：工作區「＋」入口、對話框、自動納管開啟及 rail 識別。
- `18414ff` 新增 SCM worktree 分頁，提供列表、切換、移除、dirty 兩段確認與 prune。
- `486c3cb` 在分支分頁加入「在新 worktree 開啟」，checkout 衝突時可跳轉到既有 worktree。
- `6f008da` 建立 worktree 效能 budget 與整合回歸；`80066d6` 再依 ship 審查強化錯誤處理及量測穩健性。
- `98ca03d` 終端機支援 `Ctrl+V`、右鍵貼上與 `Ctrl+Shift+C` 複製。
- `84a9bf6` 在安全護欄下開放 OSC 52 寫入剪貼簿，使 Claude Code 選取複製可用。
- `e03e052` 改善 AI 狀態掃描的 fail-open、背景化與掛載快照，減少狀態燈閃爍或延遲。
- `6adbf19` 視窗座標離開所有螢幕工作區時自動重設置中，處理拔除外接螢幕與解析度變更。
- `18db9ff` 修正 emoji 亂碼並加入終端機字型設定。

## v0.1.0（2026-07-01）

首個可用版：多工作區、終端機多開（真 PTY）、檔案總管／Monaco 編輯器、Git 原始碼控制、三主題與 portable 打包。tag `v0.1.0` 位於 `e6b803b`。

### 2026-07-01｜總覽、檔案操作、預覽與 portable 基線

- `cc88c2d` 集中修正 AI 監控與 Explorer dogfood 問題。
- `297532f`、`bbdca44` 將 Claude 與 Codex 狀態改為真實 process 偵測，降低殘留狀態誤判。
- `bb9e66f` 外部改檔不再立即彈窗打斷編輯，改到關檔時提醒處理衝突。
- `4a72511` 建立 Claude／Codex 用量讀取後端；`efa56f0` 加入總覽面板；`6eb7a91` 再補自動更新、工作區欄顯隱與版面重設。
- `fff519a` 三套主題統一採用 Geist 字型。
- `02ae997`、`57e4df7` 支援從系統剪貼簿把外部檔案貼入 Explorer，並補上焦點不在可編輯元素時的 paste catcher。
- `ba28ed3` 依審查修正 statusline 編碼／BOM、symlink 刪除與 SCM discard 回收桶行為。
- `b1afe72` 將總覽面板改為全視窗遮罩並置中。
- `691bf3e` 新增 XLSX／XLS 表格預覽，包含欄標、列號及多工作表切換。
- `41fbb8d` Explorer 刪除改移到資源回收桶，與 SCM 行為一致且可救回。
- `a88de49` 修正 danger 按鈕 hover 在淺色背景下看不清楚。
- `be3fa2e` 補記 typecheck 與 Playwright 驗證嘗試，讓後續能追蹤測試結果與失敗脈絡。
- `50125c9` 加入 MIT License、README 與 portable 打包設定；`e6b803b` 修正 native 模組重編與 asarUnpack，並在此 commit 標記 `v0.1.0`。

### 2026-06-30｜終端編碼、版面操作、Git 認證與 Codex 監控

- `16aeb28` 修正終端機亂碼、banner 洪水與 PowerShell 中文顯示。
- `d005ec9` 加入面板拖曳換位、標頭整併、真隱藏及可拖曳工作區寬度。
- `f192b77` 修正 Git pull／push 認證，並加入 AI 智慧產生 commit message。
- `a3db22a` 修正剛開啟 Claude 就誤顯示執行中，以及 working 殘留的時效問題。
- `0dd1eb4` 以 rollout JSONL 零侵入監控 Codex 狀態。
- `dea41f8` 新增 VS Code 風格 Explorer 右鍵新增、改名、刪除與剪貼操作。

### 2026-06-29｜第一次 dogfood、效能、安全與互動深化

- `5208903` 版面工具列新增「編輯器」顯示／隱藏。
- `dda9413` Git 歷史加入 swimlane commit 線圖；`ddfbe8c` 修正跨列斷線、拓撲排序及 dirty tree 切分支流程。
- `a4ffbc3` 建立 VS Code 風格無框標題列、自訂選單與視窗控制。
- `d791a2c` 建立冷啟動、工作區切換、開檔、按鍵延遲與 10 工作區背景 CPU 的效能量測基線。
- `65a3f42` 完成 a11y pass：axe 無 serious／critical 違規，並以純鍵盤完成新增工作區、開檔及存檔。
- `ce9596b` 完成 spawn env 白名單、Git 執行環境、renderer CSP／權限及終端 escape 安全硬化。
- `a125dbb` 依 ship 對抗式審查修正一項高風險與多項中低風險問題。
- `da63e65` 點擊 SCM 變更檔會在編輯器區開 diff 分頁，並提供 worktree checkout 衝突提示。
- `6161db6` Claude 狀態加入文字標籤、待接手桌面通知與總覽計數。
- `011f2da` Git commit 線圖加入完整 hover 資訊及複製、查看變更、checkout、建立分支等右鍵操作。
- `f11d2e0` 擴充 SCM：hover 可滑入、commit 可展開檔案、untracked diff 與變更右鍵操作。
- `0b49a49`、`21fb781` 修正版面重設與顯隱造成面板 dispose、終端內容遺失或破版。
- `888807e` 修正 Claude 關閉後狀態仍卡在執行中。
- `cec83ce`、`b9ba8d0`、`cadc4be` 分三階段導入 Claude hooks 狀態接線與可靠路徑解析。
- `60ff8d1` 終端機從單純 tab 切換升級為可並排／上下分割及拖曳調整。
- `49c3a55` 手動 stash 改為包含 untracked 檔案。
- `bb9478e` 整併終端機標頭，面板真隱藏時序列化保留 scrollback。

### 2026-06-28｜從零建立 Polydesk

- `adcc4b8` 建立 Electron／React／TypeScript 三進程骨架、typed IPC、StateStore、單一實例、安全基線與效能埋點。
- `30668eb` 完成 dockview 版面、深／淺／暖三主題、設定匯出入、dialog host 與 workspace 模型。
- `47a2d23` 一次打通五項核心 IDE 能力：工作區、Explorer、ConPTY 終端機、Monaco 編輯器與 Git GUI。
- `24cfc58` 提供 PTY 子程序探測接縫；`6f78312` 擴充 LSP request／sync／diagnostics IPC。
- `85b136b` 完成六語言 LSP bridge、ripgrep 全域搜尋、Claude 狀態監控及 dock 版面持久化。
- `62a8a37` 修正 SearchService ESM 非同步重構後的測試收斂問題。
- `c7a5065` 建立 electron-builder 打包、自動更新、原生模組 asarUnpack 驗證與 updater IPC。

## 維護紀錄的原則

後續每次功能交付，應從實際 Git commit 補入本文件，至少包含日期、使用者旅程、問題原因、主要影響範圍與可追溯短雜湊。純 journal／ledger 對帳、無產品行為變化的測試資料整理，可留在 Git 歷史與 `specs/tasks.md`，不重複包裝成使用者更新。
