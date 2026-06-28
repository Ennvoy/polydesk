# Requirements — 多工作區開發終端機（codename: **Polydesk**，名稱可改）

> 狀態：訪談 + grill-me + 多視角對抗審查（含技術可行性查證）完成、已採納「拿掉內嵌瀏覽器改純 Playwright」之架構簡化，待 spec-ready → UI 定版 → 凍結。
> 推進模式：**auto（自駕）**。任務類型：`desktop-gui`（Electron，web 技術 → UI mockup 具代表性）。

---

## 1. 願景與核心特色

打造一個**自用**桌面開發環境，模仿 VSCode 的檔案總管／原始碼控制／編輯器，並讓 **Claude 能像 Playwright 一樣對網頁做自動化測試**；最大特色是**左側工作區列表**——同時掛載、切換、背景運行與監控**多個本機資料夾工作區**，達成「同時開發、區別、監控多專案」。目標：**取代 VSCode 成為主力開發環境**。

**核心差異化（與 VSCode 最大不同）**：
1. 左側常駐**工作區列表**：一鍵切換多工作區、背景持續運行、即時監控狀態。
2. 每個工作區**各自擁有**獨立終端機與獨立的瀏覽器測試環境；在該工作區終端機內啟動的 `claude` 由 app **自動接線**（零設定、零 repo 足跡）到**該工作區專屬的 Playwright 測試瀏覽器**（獨立 profile），各工作區的 Claude 互相獨立、可平行。

**架構關鍵決策（採納使用者提案）**：不自建「被 Claude 驅動的內嵌瀏覽器」。Claude 的網頁測試**直接走 Playwright**（官方 `@playwright/mcp`，headed 可即時觀看），如此 (a) 「像 Playwright 做測試」需求由 Playwright 本體 100% 滿足、(b) 不需暴露任何無認證的 CDP 控制端口、不存在「工作區程式劫持已登入瀏覽器」的安全漏洞、(c) 大幅省工。**v1 不提供 app 內手動瀏覽網頁功能**（需要時用 Playwright 視窗或外部瀏覽器）。

> 技術基礎仍採 **Electron**：Monaco、xterm.js、node-pty、electron-builder 生態成熟、最貼近 VSCode 體驗、交付最穩；Playwright 為獨立外部程序、與 Electron 無耦合。

---

## 2. 主要使用者與目標

- **唯一角色**：開發者本人（自用，無多使用者/權限/RBAC）。
- **目標**：單一視窗同時管理多個本機專案——逐專案編輯（多語言）、操作 git、開終端機跑指令、讓 Claude 經 Playwright 自動化測試網頁，並一眼掌握每個專案狀態。

---

## 3. 範圍（Scope）

### v1 範圍內
工作區管理（新增/移除/切換/背景運行/狀態監控）｜整合 shell 終端機（多 shell、real PTY、可切 shell）｜內建 Monaco 編輯器（編輯/存檔/語法高亮 + TS/JS 內建智能 + 通用 LSP 橋接與語言登錄表、自動偵測）｜完整 git GUI（diff/stage/commit/push/pull/branch/history/stash，呼叫系統 git）｜**Claude↔Playwright 自動接線**（每工作區獨立 profile 的 Playwright 測試瀏覽器）｜全域跨檔搜尋（含取代）｜分割編輯器並排｜深/淺/暖三主題｜狀態持久化 + 匯出匯入 + 單一實例 + 重啟還原｜electron-builder 打包 Windows app + 自動更新通道。

### v1 範圍外
擴充套件/外掛系統｜遠端開發工作區（SSH/Dev Container/WSL 當工作區來源；WSL/Git Bash 仍可當終端機 shell）｜多使用者/權限/RBAC｜app 內手動瀏覽網頁的內嵌瀏覽器｜app 內建 Claude 對話面板（用外部 Claude Code）｜真正 PASS/FAIL 測試結果回報管道（v1 用可觀測訊號）｜app 內 Claude 登入 UI。

---

## 4. 功能需求（EARS）

### 4.1 工作區管理（REQ-WS）
- **REQ-WS-001**：系統應在左側常駐工作區列表，列出所有已加入的工作區（顯示名稱 + 狀態徽章）。
- **REQ-WS-002**：當使用者「新增工作區」時，系統應提供開資料夾對話框，將選定本機資料夾加入列表，預設顯示名稱為資料夾名；應**去重**（同一路徑不重複加入），並對磁碟根目錄/超大目錄樹給警告。
- **REQ-WS-003**：系統應允許重新命名顯示名稱與手動移除工作區（提供右鍵選單／hover 操作入口）。
- **REQ-WS-010**：系統應允許在工作區列表中**拖曳排序**工作區，排序持久化。
- **REQ-WS-004**：當使用者點選某工作區時，系統應於 < 200ms（已載入者，見 REQ-PERF-002）切換主畫面至該工作區內容。
- **REQ-WS-005**：當切換到另一工作區時，系統應使前一工作區的**終端機程序與 dev server 持續在背景運行不中斷**（Playwright 測試瀏覽器為要用才開的暫態程序，不在此續跑保證內）。
- **REQ-WS-006**（Unwanted｜資料夾遺失）：若偵測到某工作區資料夾不存在，系統應標記為「無法使用」保留在列表（灰化 + 警告），不自動移除，並提供「移除」或「重設路徑」。
- **REQ-WS-007**（Unwanted｜空狀態）：若列表為空，系統應顯示歡迎頁與「新增工作區」入口。
- **REQ-WS-008**（信任決策）：將新資料夾加入為工作區視為一次信任授權；系統應在對一個新資料夾首次執行 git 等操作前提示使用者確認。
- **REQ-WS-009**（移除清理）：當移除工作區時，系統應**預設保留**其設定與該工作區 Playwright profile，但提供「連同瀏覽資料（profile/登入/快取）一併刪除」選項並二次確認；**不論是否刪資料，移除時都應完整 teardown 該工作區執行中的終端機程序、Playwright 程序與監看（避免殭屍程序）**。

### 4.2 狀態監控（REQ-MON）
> 設計定調：工作區列表的**主狀態 = 該工作區的 Claude 執行狀態**（使用者最在意「哪個還在跑、哪個停了該接手」）。git/程序/未存檔等不放在列表主徽章，改於各自面板呈現。
- **REQ-MON-001**：系統應於工作區列表上，為每個工作區顯示**單一最顯眼的主狀態徽章 = 該工作區的 Claude 執行狀態**，三態：**執行中**（綠，脈動）/ **已停·待接手**（琥珀）/ **未啟動**（灰）。
- **REQ-MON-002**（Claude 狀態偵測）：系統應利用其掌握的該工作區終端機 PTY，判定 Claude 執行狀態——**執行中**＝終端機有 `claude` 程序且最近有輸出/子程序活動；**已停·待接手**＝`claude` 程序在但停在提示等待輸入、或剛結束（含結束碼）；**未啟動**＝該工作區終端機無 `claude` 程序。判定不得僅靠刮取終端機可見輸出做語意推測（先 strip ANSI/escape；程序存在性以乾淨子程序查詢）。
- **REQ-MON-003**：系統應於**原始碼控制面板**呈現每工作區 git 狀態（分支、變更檔數、相對 upstream 的 ahead/behind）。（Unwanted：無 remote/無 upstream/detached HEAD/新分支未 push 時顯示 N/A，不報錯、不顯示誤導的 0。）
- **REQ-MON-004**：系統應於切換至工作區後，於相應面板/標題呈現該工作區的**終端機/程序活動**（dev server 等）與**未存檔變更**數；程序活動以**獨立乾淨子程序查詢**取得，不刮取終端機輸出。
- **REQ-MON-005**：背景（非當前）工作區的 **Claude 執行狀態與 git 狀態仍應持續更新**：當前工作區以檔案系統監看（即時）更新，背景工作區以定期輪詢更新（預設 **5s**、可調、隨工作區數自適應放大間隔）；watcher 層即排除 `node_modules`、`.git` 內部物件等重目錄。
- **REQ-MON-006**（資源有界，可量測）：當背景工作區增加時，系統的背景監控總開銷應有界——N 個背景閒置工作區的監控總 CPU 占用應維持低水位（design 釘定具體門檻與量測法），不得持續高佔 CPU。

### 4.3 整合終端機（REQ-TERM）
- **REQ-TERM-001**：系統應為每工作區提供整合 shell 終端機，使用 real PTY（Windows 經 ConPTY / node-pty），cwd 為該工作區資料夾。
- **REQ-TERM-002**：系統應允許每工作區開啟**多個**終端機（以分頁/清單呈現、可隨時「＋」新增、可關閉個別終端機）。
- **REQ-TERM-003**：系統應以 **PowerShell 為預設 shell**，可切換 cmd/pwsh/Git Bash/WSL，且每工作區可設自己的預設 shell。
- **REQ-TERM-004**：系統應使每工作區終端機的工作目錄(cwd)=該工作區資料夾（見 REQ-TERM-001），使其中執行的 `claude` 透過官方 @playwright/mcp 自動取得 per-workspace profile；**app 不額外注入接線環境變數**。
- **REQ-TERM-005**：系統應達到終端機按鍵延遲 < 50ms（見 REQ-PERF-004）。
- **REQ-TERM-006**（Unwanted｜shell 崩潰）：若 shell 程序異常結束，系統應顯示 exit code、提供一鍵重啟，且不影響其他終端機與工作區。
- **REQ-TERM-007**（Unwanted｜關閉時有跑中程序）：若關閉某工作區或整個 app 時該工作區仍有執行中程序，系統應彈窗警告、列出執行中程序、要求確認才關閉；無則靜默關閉。
- **REQ-TERM-008**（終端機安全硬化）：系統應對終端機輸出做 escape 硬化——OSC 52 剪貼簿寫入預設關閉或需確認、淨化 OSC 8 連結、限制視窗標題 escape、終端機回應不得回灌成輸入。

### 4.4 編輯器（REQ-EDIT）
- **REQ-EDIT-001**：系統應內嵌 Monaco，支援開檔、編輯、存檔、**其支援語言集的語法高亮（未支援者回退純文字）**、多游標、檔內找/取代、minimap、括號配對。
- **REQ-EDIT-002**：系統應對 TS/JS 提供 Monaco 內建自動完成與型別檢查（無需外部伺服器）。
- **REQ-EDIT-003**：系統應提供**通用 LSP 橋接**與**語言登錄表**（副檔名→語言伺服器），初始登錄至少 Python(Pyright)、Go(gopls)、Rust(rust-analyzer)、C/C++(clangd)、Java(jdtls)、C#(C# server)。
- **REQ-EDIT-004**：當開啟某語言檔案時，系統應自動偵測對應語言伺服器是否可用，可用則啟用完整 IntelliSense（自動完成/跳定義/診斷/hover）。
- **REQ-EDIT-005**（Unwanted｜缺語言伺服器）：若所需語言伺服器未偵測到，系統應仍提供語法高亮與編輯/存檔，並顯示不擋路提示告知缺哪個、提供「一鍵安裝」（app 能直接裝者，如 Pyright 經 npm；缺 npm 則退回顯示手動指令+連結）或「顯示安裝指令+官方連結」，**不得靜默失敗**。
- **REQ-EDIT-006**：系統應提供分割編輯器並排；**同一檔開在多個面板時共享同一文件模型（共用 buffer 與 dirty 狀態、即時同步），避免存檔互蓋**。
- **REQ-EDIT-007**（Unwanted｜檔被外部修改）：若開啟中檔案於磁碟被外部修改：無未存檔變更時自動重載；有未存檔變更時彈出提示讓使用者選「重載磁碟版」或「保留我的編輯」，不得自動覆蓋。
- **REQ-EDIT-008**（Unwanted｜權限不足）：若存檔因唯讀/無寫入權限失敗，系統應顯示明確錯誤，不得靜默失敗。
- **REQ-EDIT-009**（編碼與換行）：系統應偵測檔案編碼（含 Windows zh-TW 常見 UTF-8/Big5(cp950)），以原編碼正確顯示與存檔、提供切換存檔編碼；應**保留檔案原換行符（CRLF/LF）**、不擅自改寫。

### 4.5 原始碼控制（REQ-SCM）
- **REQ-SCM-001**：系統應透過呼叫**系統安裝的 git** 執行所有 git 操作（繼承使用者 git 設定/認證/SSH key）。
- **REQ-SCM-002**：系統應列出變更檔並可點開看 diff。
- **REQ-SCM-003**：系統應支援 stage/unstage、撰寫 commit message 並提交。
- **REQ-SCM-004**：系統應支援 push 與 pull。
- **REQ-SCM-005**：系統應支援分支建立/切換、commit 歷史瀏覽、stash。
- **REQ-SCM-006**（Unwanted｜非 git repo）：若工作區無 `.git`，系統應顯示「尚未初始化」並提供一鍵 `git init`。
- **REQ-SCM-007**（Unwanted｜操作失敗/逾時）：若 git 操作失敗（push 被拒/無 remote/認證失敗/merge conflict/網路斷），系統應顯示明確錯誤並允許重試，不得偽裝成功；網路類操作應有明確逾時（design 定值），逾時即回錯。
- **REQ-SCM-008**（併發）：同一工作區有 git 操作進行中時，後續 git 操作應序列化並於 UI 顯示「進行中」。
- **REQ-SCM-009**（git 安全硬化）：所有 git 呼叫應用 argv 陣列 + `shell:false`（execFile/spawn）、參數前置 `--`、commit message 經 `-F tempfile`/stdin；branch/remote 名做格式驗證；唯讀監控操作加 `GIT_CONFIG_NOSYSTEM=1`、空 `core.hooksPath`、`core.fsmonitor=false`、`--no-pager`、不啟用不可信 textconv、尊重 `safe.directory`。

### 4.6 Claude↔Playwright 網頁測試（REQ-PW）— 核心差異化
> 設計定調（採用使用者實戰驗證）：**完全沿用官方 `@playwright/mcp`，app 不自建接線、不註冊 MCP、不管理 profile、不注入 env**。官方 MCP 依「啟動它的 claude 的工作目錄(cwd)」自動分流 persistent profile（在 `%LOCALAPPDATA%\ms-playwright`），故每個工作區的 claude 在自己資料夾 cwd 跑即自動獲得 per-workspace profile 隔離、可平行、零 repo 足跡。app 唯一責任＝終端機 cwd=工作區資料夾（REQ-TERM-001）。
- **REQ-PW-001**：系統應使每個工作區的 Claude 網頁測試使用**該工作區專屬、互不干擾的 Playwright persistent profile**（由官方 @playwright/mcp 依該工作區終端機 cwd 自動分流達成）。
- **REQ-PW-004**：Claude 的網頁測試應以 **headed** 方式執行（@playwright/mcp 預設）。
- **REQ-PW-005**：不同工作區的 Claude 各自於其工作區終端機執行，**可平行運作**、各用各自 cwd profile、互不干擾。
- **REQ-PW-006**（Unwanted｜相依缺席）：若偵測到使用者環境未安裝 @playwright/mcp 或 Playwright 瀏覽器，系統應顯示明確提示與安裝指引（不崩潰），**不替使用者自動寫入全域 Claude 設定**。
- **REQ-PW-007**：系統不在 app 內處理 Claude 認證、不註冊 MCP、不管理 profile、不注入接線環境變數——沿用使用者既有的 @playwright/mcp 設定（claude 由使用者於終端機 `claude` 啟動，全機共用認證）。
> 已移除（依「不接線」決策）：原 REQ-PW-002（app 註冊 MCP）、REQ-PW-003（env 注入）、REQ-PW-008（接線機密衛生）——app 不做接線故不適用。

### 4.7 全域搜尋（REQ-SEARCH）
- **REQ-SEARCH-001**：系統應提供工作區範圍跨檔字串搜尋，列出符合檔案與行。
- **REQ-SEARCH-002**：系統應支援跨檔取代。
- **REQ-SEARCH-003**：系統應略過 `node_modules`、`.git` 等預設忽略目錄（可調）。
- **REQ-SEARCH-004**（效能/可中止）：大型 repo 搜尋應**串流結果、可隨時取消、不卡 UI**，並對結果量設上限/分頁；超量時明示已截斷。
- **REQ-SEARCH-005**：當使用者點選搜尋結果時，系統應**自動開啟該檔、跳轉到對應行並高亮該列**。

### 4.8 主題與介面（REQ-THEME / REQ-UI）
- **REQ-THEME-001**：系統應提供**深色/淺色/暖色**三主題，可即時切換。
- **REQ-THEME-002**：系統應持久化主題選擇，重啟沿用。
- **REQ-UI-001**：系統應採類 VSCode 單視窗版面（活動列+側邊欄+編輯區+底部面板），並在左側額外納入**工作區列表**作為最上層切換軸。
- **REQ-UI-002**：系統應使各面板（工作區列表、側欄、編輯區、終端機面板）可**拖曳調整大小**，並可**展開/隱藏**（左欄、側欄、終端機）與**最大化終端機**（全高、暫隱編輯區）。
- **REQ-UI-003**：系統應支援面板**拖曳重新停靠/重排（dockable，如 VSCode 將面板移至上/下/左/右）**；版面配置（大小、停靠、顯隱）應持久化、重啟還原、可一鍵重設。
- **REQ-UI-004**：系統應對所有互動元素提供無障礙標籤（aria）與順暢全域鍵盤導航。

### 4.9 持久化與生命週期（REQ-PERSIST）
- **REQ-PERSIST-001**：系統應將工作區清單/顯示名稱/各工作區設定/主題/版面/開啟檔清單持久化於 app 的 userData，**不寫入任何使用者專案資料夾**。
- **REQ-PERSIST-002**：系統應為**單一實例**；再次啟動時將既有視窗帶到前景。
- **REQ-PERSIST-003**：當 app 重啟時系統應還原版面/主題/工作區清單/先前開啟檔；對先前開啟的終端機記住其配置並提供重新開啟（**不保證復活已結束的程序**）。
- **REQ-PERSIST-004**（韌性）：狀態檔應含 schema 版本欄位與向後相容/遷移；損毀時自動備份並以預設啟動（不 brick）。
- **REQ-PERSIST-005**（可攜）：系統應提供工作區清單與設定的**匯出/匯入**（換機/重灌可還原）。

### 4.10 安全基線（REQ-SEC）
- **REQ-SEC-001**（renderer 基線）：app 自有 UI renderer 應採 `contextIsolation:true`、停用 `nodeIntegration`、盡量 sandbox、preload 僅暴露最小化且無洩漏的 IPC。
- **REQ-SEC-002**（子程序環境最小化）：app 主動 spawn 的子程序（尤其 git）應傳入清洗過的最小環境，移除接線機密與無關 `GIT_*`；接線 env 僅注入終端機 PTY。
- **REQ-SEC-003**（威脅模型）：design 應明文威脅模型，把「工作區內執行的程式碼」視為半可信對手（對齊 REQ-WS-008 信任決策）。

---

## 5. 端到端旅程（REQ-E2E）— Phase 4/5 驗證來源（皆從真實入口走到目標、禁 deep-link）
- **REQ-E2E-001（新增/切換工作區）**：啟動→空列表顯示歡迎頁→新增工作區 A（git repo，徽章顯示乾淨/變更數/ahead-behind/或非 repo/無法使用其一）→再新增 B→點 A 顯示 A 的檔案樹/終端機→點 B 切換到 B→切回 A 時 A 先前終端機仍背景運行。
- **REQ-E2E-002（編輯/存檔/IntelliSense 退化）**：選工作區→開 TS 檔，輸入時出現自動完成→改後存檔，未存檔徽章消失→開一個**測試環境保證未安裝其語言伺服器**的檔，顯示語法高亮並彈缺件提示（不擋編輯）。
- **REQ-E2E-003（git）**：編輯一檔造成變更→面板出現該變更→看 diff→stage→寫 message→commit→變更清空、未推送數+1→切換分支再切回（fixture：已設 upstream、≥2 分支）。
- **REQ-E2E-004（Claude 經 Playwright 測試 — 核心）**：選工作區 A→在 A 終端機跑 `claude`→請其用 Playwright 開某 URL 並點擊→**即時看到** Playwright headed 視窗導航/點擊→A 徽章顯示「自動化進行中」→切到 B、於 B 終端機跑另一 `claude` 對 B 操作→A、B 各用各自 profile 平行完成、互不干擾。（驗證分層見 REQ-E2E-NOTE。）
- **REQ-E2E-005（多工作區背景監控）**：掛載 ≥2 工作區，於其一跑 dev server→切到另一工作區→前者「終端機/程序活動」與「git」徽章在背景持續更新可見。
- **REQ-E2E-006（全域搜尋）**：選工作區→開全域搜尋→輸入字串→串流列出跨檔結果（可取消）→點結果跳到對應檔行。
- **REQ-E2E-007（主題）**：切換深/淺/暖→即時套用→重啟後沿用。
- **REQ-E2E-008（關閉時跑中程序）**：工作區有跑中程序→關閉該工作區/app→彈窗列出跑中程序並要求確認→確認後完整 teardown、無殘留。
- **REQ-E2E-009（外部修改衝突）**：開著一檔並做未存檔編輯→外部修改該檔→出現提示→選「保留我的」或「重載磁碟版」各驗一次行為正確。
- **REQ-E2E-010（profile 隔離）**：於工作區 A 的測試瀏覽器登入某站→於工作區 B 開同站→B 看不到 A 的登入（profile 隔離）。
- **REQ-E2E-011（a11y）**：以鍵盤（不用滑鼠）完成「新增工作區→開檔→存檔」主路徑，焦點順序與 aria 標籤正確。
- **REQ-E2E-NOTE（驗證分層，journey-check 核可例外）**：REQ-E2E-004 的硬性自動化關卡以**決定性 Playwright 腳本**（下達與 Claude 等價的 navigate/click）驗接線/profile 路由/headed 可見/徽章/跨工作區隔離；**「真的 claude 端到端」列為人工/半自動驗收、不進硬閘門**（避免將完成謂詞綁在 flaky + 有費用 + 遞迴呼叫 Claude 的測試上）。此為 flow journey-check 的明示核可例外。

---

## 6. 效能預算（REQ-PERF）— Phase 5 硬閘門（量測前提：記錄基準機規格、連續 30 次取 p95、以程式 timestamp 埋點而非肉眼計時、註明量測時工作區數與背景負載）
- **REQ-PERF-001**：app 冷啟動至**可互動**（主視窗 + 工作區列表可點擊；採 lazy 還原，被點到的工作區才實體化）< **3s**（p95）。埋點：主程序啟動→工作區列表可點擊。冷啟動預算與「首次切換某工作區的初始化成本」分開計。
- **REQ-PERF-002**：切換至**已載入**（已實體化）的工作區 < **200ms**（p95）。首次載入某工作區允許較長，但應顯示 loading/skeleton、不阻塞 UI。
- **REQ-PERF-003**：開啟**一般檔案**（≤1MB 或 ≤5000 行；超過走 large-file 模式另計）至**顯示完成**（Monaco 首屏 token 化渲染完成事件）< **500ms**（p95）。
- **REQ-PERF-004**：終端機按鍵輸入延遲 < **50ms**（p95）。

---

## 7. 非功能需求（REQ-NFR）
- **REQ-NFR-001（相依與降級）**：依賴使用者機器已安裝 **git**、**Claude Code CLI**、**Playwright（含瀏覽器）**；缺席時對應面板顯示明確提示與安裝指引而非崩潰。語言伺服器、`node/npm`（EDIT-005 一鍵安裝前提）為選用，缺則退化。
- **REQ-NFR-002（隔離與自動恢復）**：元件級隔離——renderer crash 只重建該元件、PTY crash 只重啟該終端機、Playwright crash 只影響該工作區；記憶體 watchdog 限制失控元件。誠實標註 main/GPU 程序為 Electron 固有單點故障。
- **REQ-NFR-003（打包）**：v1 應由 electron-builder 打包為可雙擊啟動的 Windows app；原生模組（node-pty）以 `@electron/rebuild` + `asarUnpack`（`**/*.node`、node-pty、winpty.dll/spawn-helper 落在 `app.asar.unpacked`）正確打包。
- **REQ-NFR-004（更新通道）**：app 作為主力 IDE，應具備**自動更新/安全修補通道**（如 electron-updater），使內嵌 Electron/Chromium 的 CVE 可被修補。
- **REQ-NFR-005（WSL 限制）**：WSL 作為終端機 shell 時，`claude` 自動接線到 Windows 側 Playwright **不保證**（WSL2↔Windows loopback 互通有網路細節），需技術驗證；應避免讓 REQ-PW-003 在 WSL 變成隱性失敗（偵測到則明示）。

---

## 8. 開放問題

無

## 9. 延後決策（附 AI 建議預設，將以 flow-state decision 記審計線）
- **D-NAME**：正式名稱未定，暫用 codename「Polydesk」。建議出貨前再命名。
- **D-TEST-REPORT**：真 PASS/FAIL 測試結果回報管道延後；v1 用可觀測訊號。建議之後加 MCP 回報工具或結果檔監看。
- **D-LSP-MORE**：初始登錄表外的少見語言 LSP 延後，按需加列。
- **D-CLAUDE-PANEL**：app 內建 Claude 對話面板延後（v1 用外部 Claude Code）。
- **D-LOGIN-UI**：app 內 Claude 登入狀態指示延後。
- **D-INAPP-BROWSER**：app 內手動瀏覽網頁的內嵌瀏覽器延後（v1 拿掉、純 Playwright）。需要再評估。
