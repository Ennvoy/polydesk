# Tasks — 多工作區開發終端機（Polydesk）

> 進度雙軌：本檔人讀（[ ]/[x]）+ 機讀 schema 同步。**不跨段移動**：task 從 pending 到 done 就在原段把 [ ] 改 [x]。
> 一個 task = 一個能 demo 一次的 user story（含 UI + main + IPC + tests + e2e）。
> 依賴分波依 `blockedBy`（已 delivered）∧ `conflictZone`（互不重疊）計算。對應凍結 `requirements.md` / `architecture.md` / `design.md`。

---

## Prelude（P-*，跨 feature 基礎建設；先序列釘死接縫，消除型別型 blockedBy）

判準：「砍掉它任一 feature 都做不下去」。中央檔（IPC 契約、主題、layout 引擎）一律收在 Prelude 序列，features 各寫自己的檔。

- [x] **P-1 Electron 骨架 + IPC 契約接縫 + 狀態持久化 + 單一實例**
      story：開發者雙擊啟動 app，看到單一視窗空殼（contextIsolation/sandbox/CSP 安全基線就位），關掉再開會把既有視窗帶前景，主題/版面/工作區清單能寫進 userData 並在重啟後讀回（損毀自動備份、不 brick）。**本 task 一次釘死 `src/shared/ipc.ts`+`types.ts` 全部通道與領域型別（單一真相），並把 preload 依契約一次性產出全 namespaced API、router.ts 預連所有 feature 的 `registerXxxHandlers` 空樁、埋點 perf timestamp helper**——此後 features 不再碰中央契約檔。
      reqRefs：REQ-PERSIST-001/002/003/004/005、REQ-SEC-001、REQ-NFR-001
      blockedBy：—
      conflictZone：package.json、vite.config.ts、electron-builder.yml、tsconfig*.json、src/shared/（ipc.ts、types.ts、channels.ts、constants.ts）、src/main/index.ts、src/main/ipc/、src/main/store/、src/preload/、src/renderer/main.tsx、src/renderer/App.tsx、src/renderer/ipc/client.ts、src/shared/perf.ts
      verify：`npm run build` 綠 + 啟動後二次啟動只帶前景單視窗 + 寫入 state.json 後重啟讀回主題/版面（人手毀檔驗證自動備份 + 預設啟動不崩潰）。

- [x] **P-2 UI foundation：dockable layout 引擎 + activity bar + 三主題系統 + dialog host + 設定面板**
      story：開發者看到類 VSCode 預設版面（dockview 驅動，所有面板槽以 placeholder 註冊在 panelRegistry，features 各自實作對應 placeholder）、左側 activity bar 可切功能，能在設定面板即時切換深/淺/暖三主題（tokens.css 落地三套 CSS 變數）、切換後重啟沿用，並可匯出/匯入設定。**本 task 預連 panelRegistry 全部 lazy 槽位 + 共用 dialog host，features 不碰 DockLayout.tsx/panelRegistry/theme。**
      reqRefs：REQ-UI-001、REQ-THEME-001/002、REQ-PERSIST-005、REQ-E2E-007
      blockedBy：P-1
      conflictZone：src/renderer/layout/（DockLayout.tsx、panelRegistry.ts）、src/renderer/components/ActivityBar.tsx、src/renderer/theme/（ThemeProvider.tsx、tokens.css）、src/renderer/components/Settings/、src/renderer/components/Dialogs/host.tsx
      verify：Playwright headed 切深→淺→暖即時套用、重啟沿用（對齊 REQ-E2E-007）；匯出 JSON→改主題→匯入還原。

- [x] **P-3 workspace 模型基礎（WorkspaceManager + lazy 實體化 + teardown 協調）**
      story：main 端有完整工作區模型——CRUD、路徑去重、拖曳排序持久化、lazy 實體化（被 activate 才 hydrate）、資料夾遺失偵測標 missing、移除時 teardown 協調掛鉤；對應 `workspace:*` invoke handler 全部接上（UI 由 F-1 接）。
      reqRefs：REQ-WS-001/002/005/006/009、REQ-PERF-001
      blockedBy：P-1
      conflictZone：src/main/workspace/（WorkspaceManager.ts、workspaceLifecycle.ts）
      verify：main 端單元測試：去重拒重複路徑、reorder 持久化、activate 才 hydrate、刪除呼叫 teardown hook、不存在路徑標 missing 不丟列表。

## Features（F-*，每個 = 一條 user story = 全層）

判準：能向使用者 demo 一次、對應一條完整 REQ 或 REQ-E2E-*。features 各寫自己的檔以降低 conflictZone 重疊。

- [x] **F-1 工作區新增/切換/改名/刪除/拖曳排序（含空狀態歡迎頁 + 信任確認 + Claude 徽章殼）**
      story：空列表顯示歡迎頁 CTA→新增工作區 A（去重、根目錄/超大樹警告、信任確認彈窗）→再新增 B→點 A 切到 A、點 B 切到 B（已載入 <200ms）→改名、右鍵/hover 移除（含「連同 profile 刪除」二次確認）→拖曳排序持久化。**建 ClaudeStatusBadge 元件並訂閱 `claude:status` 事件（預設 idle，真實狀態由 F-8 推），不耦合監控邏輯。**
      reqRefs：REQ-WS-001/002/003/004/006/007/008/010、REQ-PERF-002、REQ-E2E-001
      blockedBy：P-1、P-2、P-3
      conflictZone：src/renderer/components/WorkspaceRail.tsx、src/renderer/components/EmptyWelcome.tsx、src/renderer/components/ClaudeStatusBadge.tsx、src/renderer/components/Dialogs/TrustConfirm.tsx
      verify：Playwright headed 從歡迎頁真實點擊走完新增 A→新增 B→切 A→切 B（對齊 REQ-E2E-001）；切已載入工作區埋點 p95 <200ms。

- [x] **F-2 檔案總管樹（Explorer + FileWatcher 即時反映）**
      story：選工作區後側欄顯示該工作區檔案樹，展開/收合資料夾、點檔開啟（交給 F-4 editor），外部新增/刪除/改名即時反映；watcher 層排除 node_modules/.git 重目錄。
      reqRefs：REQ-WS-004、REQ-MON-005、REQ-E2E-001
      blockedBy：P-1、P-2、P-3
      conflictZone：src/renderer/components/Explorer.tsx、src/main/fs/FileWatcher.ts
      verify：Playwright 展開樹 + 在磁碟新增檔案後樹即時出現該檔；確認 node_modules 不被監看（watcher 計數）。

- [x] **F-3 整合終端機多開（xterm + node-pty/ConPTY + 多分頁 + shell 切換 + 崩潰重啟 + 關閉確認 + escape 硬化 + Claude/Playwright 缺件偵測）**
      story：每工作區可「＋」開多個 real PTY 終端機（預設 PowerShell，可切 cmd/pwsh/Git Bash/WSL、每工作區記預設）、**cwd=工作區資料夾**、切走後背景續跑、shell 崩潰顯示 exit code 一鍵重啟、關閉工作區/app 若有跑中程序彈窗列出要求確認後完整 teardown。**app 不做接線、不註冊 MCP、不注入 env**：在工作區終端機跑 `claude` 即由官方 `@playwright/mcp` 依該 cwd 自動取得 per-workspace persistent profile（隔離、可平行、零 repo 足跡）；偵測使用者環境缺 `@playwright/mcp`/Claude CLI/Playwright 瀏覽器時顯示不擋路安裝指引（不崩潰、不自動寫全域設定）；偵測到 WSL shell 明示接線不保證（REQ-NFR-005）。按鍵延遲達標、escape 硬化（OSC 52/8、標題、回灌）。
      reqRefs：REQ-TERM-001/002/003/004/005/006/007/008、REQ-WS-005/009、REQ-PERF-004、REQ-PW-001/004/005/006/007、REQ-NFR-005、REQ-E2E-004/008/010
      blockedBy：P-1、P-2、P-3
      conflictZone：src/renderer/components/Terminal/、src/main/pty/PtyManager.ts、src/renderer/components/Dialogs/CloseConfirm.tsx
      verify：Playwright 開兩個終端機跑指令、切工作區再切回前一個仍在背景跑；按鍵延遲埋點 p95 <50ms；關閉含跑中程序彈窗確認後查無殘留程序（對齊 REQ-E2E-008）；決定性 Playwright 腳本驗 cwd profile 路由/headed 可見/徽章/跨工作區隔離（REQ-E2E-004/010；真 claude 端到端列人工驗收，journey-check 核可例外）。

- [x] **F-4 Monaco 編輯 + 編碼偵測 + 存檔（分割並排共享 model + 外部修改衝突 + 唯讀/權限錯誤）**
      story：開檔（語法高亮、TS/JS 內建智能、多游標、檔內找取代、minimap）→輸入→存檔未存檔徽章消失；分割並排同檔共享同一 model（不互蓋）；偵測 UTF-8/Big5 編碼正確顯示與原編碼存回、保留 CRLF/LF；外部修改時依有無未存檔提示重載或保留；唯讀存檔失敗顯示明確錯誤。
      reqRefs：REQ-EDIT-001/002/006/007/008/009、REQ-PERF-003、REQ-E2E-002、REQ-E2E-009
      blockedBy：P-1、P-2、P-3
      conflictZone：src/renderer/components/Editor/、src/main/fs/fileService.ts
      verify：Playwright 開 TS 檔輸入觸發自動完成、存檔徽章消失（對齊 REQ-E2E-002 前半）；開 Big5 檔不亂碼；外部改檔走「保留我的/重載」各一次（對齊 REQ-E2E-009）；開 1MB 檔埋點 p95 <500ms。

- [x] **F-5 LSP 橋接自動偵測（語言登錄表 + PATH 探測 + 缺件不擋路降級 + 一鍵安裝）**
      story：開某語言檔→main serverProbe 探測對應語言伺服器（Python/Pyright、Go/gopls、Rust/rust-analyzer、C/C++/clangd、Java/jdtls、C#）→可用則啟用完整 IntelliSense（完成/跳定義/診斷/hover）；探測不到仍語法高亮 + 編輯存檔，顯示不擋路提示「缺 X，[一鍵安裝]/[顯示指令+連結]」，不靜默失敗；語言伺服器一律 main spawn(stdio) 橋接 renderer。
      reqRefs：REQ-EDIT-003/004/005、REQ-NFR-001、REQ-E2E-002
      blockedBy：F-4
      conflictZone：src/main/lsp/（LspManager.ts、languageRegistry.ts、serverProbe.ts）、src/renderer/components/Editor/lsp/
      verify：開保證未裝該 LSP 的檔案→顯示語法高亮 + 彈缺件提示且仍可編輯存檔（對齊 REQ-E2E-002 後半）；裝有 Pyright 環境開 .py 檔出現自動完成/診斷。

- [x] **F-6 全域搜尋（ripgrep 串流 + 可取消 + 取代 + 點選開檔跳行高亮）**
      story：開全域搜尋→輸入字串→ripgrep 串流列出跨檔結果（略過 node_modules/.git、可調、結果上限/截斷提示、隨時取消不卡 UI）→點結果自動開檔、跳對應行並高亮該列；支援跨檔取代。
      reqRefs：REQ-SEARCH-001/002/003/004/005、REQ-E2E-006
      blockedBy：F-4
      conflictZone：src/renderer/components/Search.tsx、src/main/search/SearchService.ts
      verify：Playwright 大 repo 搜尋串流出結果、按取消即停、點結果跳到正確檔行並高亮（對齊 REQ-E2E-006）。

- [x] **F-7 git GUI 含 git 樹（變更樹/diff/stage/commit/push/pull/branch/history/stash + N/A 狀態 + init 引導 + 安全硬化 + 序列化）**
      story：編輯造成變更→面板出現變更樹→點開看 diff（Monaco diff）→stage→寫 message→commit→變更清空、未推送 +1→push/pull→分支建立/切換、commit 歷史、stash；無 .git 顯示「尚未初始化」一鍵 git init；無 remote/upstream/detached/新分支顯示 N/A 不報錯；所有 git 走 execFile argv+shell:false+`--`+`-F tempfile`+名稱驗證、同工作區序列化、網路操作逾時、失敗明確錯誤不偽裝成功。
      reqRefs：REQ-SCM-001/002/003/004/005/006/007/008/009、REQ-MON-003、REQ-E2E-003
      blockedBy：P-1、P-2、P-3
      conflictZone：src/renderer/components/SourceControl/、src/main/git/（GitService.ts、gitSafeArgs.ts、gitSerialQueue.ts）
      verify：fixture（已設 upstream、≥2 分支）走 編輯→變更出現→diff→stage→commit→未推送 +1→切分支再切回（對齊 REQ-E2E-003）；非 repo 顯示 init 引導；惡意分支名被格式驗證擋下。

- [x] **F-8 Claude 狀態監控（process tree 查詢 + activity 輔助 + 前景即時/背景輪詢自適應）**
      story：工作區列表徽章顯示該工作區 Claude 三態——執行中（綠脈動）/已停·待接手（琥珀）/未啟動（灰）；以乾淨子程序查 PTY 之下 claude 程序存在性 + 最近輸出活動（strip ANSI）判定，不刮可見輸出做語意推測；當前工作區即時、背景輪詢預設 5s 隨工作區數自適應放大；經 `claude:status` 事件推給 F-1 的徽章（不改 UI 元件）。
      reqRefs：REQ-MON-001/002/004/005/006、REQ-E2E-005
      blockedBy：F-1、F-3
      conflictZone：src/main/monitor/（ClaudeStatusMonitor.ts、processProbe.ts）
      verify：在終端機跑/停模擬 claude 程序，徽章三態正確切換；掛 ≥2 工作區於其一跑程序、切到另一個背景徽章持續更新（對齊 REQ-E2E-005）；N=10 背景閒置量測總 CPU 低水位（交 X-1 量）。

> **F-9 已砍除**（decision `F9-DROP`）：原「自建接線層（註冊 MCP / 管 profile / 注入 env）」完全沿用官方 `@playwright/mcp` 依 cwd 自動分流取代；app 唯一責任 = 終端機 cwd=工作區（併入 F-3）。REQ-PW 已精簡、REQ-PW-002/003/008 移除、REQ-TERM-004 改 cwd。

- [x] **F-10 dockable 版面拖曳停靠 + 持久化（resize/上下左右停靠重排/顯隱/終端機最大化 + serialize 重啟還原 + 一鍵重設）**
      story：面板可拖曳調整大小、拖曳重新停靠/重排（如 VSCode 上下左右）、展開/隱藏左欄/側欄/終端機、最大化終端機（全高暫隱編輯區）；版面 toJSON 存 userData、重啟 fromJSON 還原（失敗 fallback 預設不 brick）、一鍵重設回預設 layout。
      reqRefs：REQ-UI-002/003、REQ-PERSIST-003
      blockedBy：P-2
      conflictZone：src/renderer/layout/DockLayout.tsx、src/renderer/layout/layoutPersist.ts
      verify：Playwright 拖曳面板停靠到另一邊 + 最大化終端機→重啟還原同一 layout→一鍵重設回預設。

## Cross-cutting（X-*，ship 前必清；/flow-ship Step 4 強制檢查）

判準：跨 feature 才能做、不屬任一 user story。

- [x] **X-1 效能 budget 量測調校（PERF 硬閘門）**
      story：以程式 timestamp 埋點（非肉眼）記基準機規格、連續 30 次取 p95，量冷啟動 <3s、切已載入工作區 <200ms、開一般檔 <500ms、終端機按鍵 <50ms，並量 N=10 背景閒置監控總 CPU 低水位；未達標調校到綠。
      reqRefs：REQ-PERF-001/002/003/004、REQ-MON-006
      blockedBy：F-1、F-3、F-4、F-8
      conflictZone：tests/perf/、scripts/perf/
      verify：perf 報告四項 p95 全達標 + 背景監控 CPU 上限達標，數據落檔。

- [x] **X-2 打包 + 自動更新（electron-builder NSIS + node-pty asarUnpack + electron-updater）**
      story：electron-builder 打包成可雙擊的 Windows app，node-pty 經 @electron/rebuild + asarUnpack（*.node、winpty/spawn-helper 落 app.asar.unpacked）正確打包；electron-updater generic provider 輪詢 latest.yml 差量更新（dev-app-update.yml 開發期模擬）。
      reqRefs：REQ-NFR-003、REQ-NFR-004
      blockedBy：F-1、F-3、F-4、F-7
      conflictZone：electron-builder.yml、dev-app-update.yml、src/main/update/AutoUpdater.ts、build/afterPack.js
      verify：產出 Setup.exe 安裝後雙擊啟動終端機正常（不報 pty.node 找不到）；模擬新版本 latest.yml 觸發更新流程到 ready。

- [x] **X-3 a11y pass（aria 標籤 + 全域鍵盤導航 + 焦點順序）**
      story：所有互動元素補 aria 標籤、焦點順序正確、可見 focus ring、全域鍵盤導航流暢；以鍵盤（不用滑鼠）完成「新增工作區→開檔→存檔」主路徑。
      reqRefs：REQ-UI-004、REQ-E2E-011
      blockedBy：F-1、F-4
      conflictZone：src/renderer/a11y/、tests/a11y/
      verify：Playwright 純鍵盤走完新增工作區→開檔→存檔主路徑，焦點順序與 aria 正確（對齊 REQ-E2E-011）；axe 掃描無嚴重違規。

- [x] **X-4 安全硬化 pass（spawnEnv 白名單 + CSP/window 旗標稽核 + 終端機/git env 機密衛生）**
      story：稽核並補齊——spawn 子程序傳白名單最小環境（剔除無關 `GIT_*`/無關機密）；複核 renderer contextIsolation/sandbox/CSP/攔外開連結；複核終端機 escape 硬化（OSC 52/8、標題、回灌）與 git argv 硬化確實生效；明文威脅模型對齊。（app 不做 Playwright 接線，故無「接線 env 衛生」項。）
      reqRefs：REQ-SEC-001/002/003、REQ-TERM-008、REQ-SCM-009
      blockedBy：F-3、F-7
      conflictZone：src/main/security/（spawnEnv.ts）、tests/security/
      verify：自動化測試確認 spawn git 的 env 無接線機密、PTY 輸出/腳本不 echo 機密、CSP 阻擋外部腳本、OSC 52 預設關閉、惡意 commit message/分支名不注入。

## Dogfood 回饋 refinements（實機試用後補強，已交付）

判準：使用者實機 dogfood 後提的 UI 補強，對既有 feature 的 refinement；不走完整 ledger，仍照 TDD/build/真 e2e 驗證後 per-commit。

- [x] **DF-1 git 歷史 commit 線圖**（swimlane lane 圖；commit dda9413）— GitLogEntry 增 parents（log `%P`）+ gitGraph.ts 純演算法（6 測試：線性/diamond/多 root/octopus/不變量/空）+ 每列 SVG 線段+節點渲染。
- [x] **DF-2 版面工具列「編輯器」顯隱切換鈕**（commit 5208903）— DockLayout TOGGLEABLE 納入 editor + addEditor + layoutPersist ToolbarState.editorVisible，顯隱經 deriveUiState 持久化還原。
- [x] **DF-3 自訂無框標題列**（VSCode 風；commit a4ffbc3）— frame:false + Menu.setApplicationMenu(null) + window:* IPC（min/max/close/isMaximized + maximizedChange）+ TitleBar（檔案/編輯/檢視 自訂選單 + 拖曳區 + 自畫視窗鈕）；e2e dogfood-ui 真 electron 截圖驗證（同時覆蓋 DF-1/DF-2）。
- [x] **DF-4 git 線圖跨列連續 + 分支切換 dirty-tree 處理**（commit ddfbe8c；含多代理對抗式審查強化）— 列高由 GRAPH_ROW_H 單一真相驅動（消 JS/CSS 漂移）、移除 border、log `--topo-order` 杜絕 dangling 線；分支切換改用結構化 status 判斷 dirty（不靠在地化錯誤字串）+ `stash -u`（含 untracked）+ 第二次 checkout try/catch；git:stash 加 includeUntracked。e2e 3 案例 + git.spec 回歸綠。
- [x] **DF-5 點變更檔在編輯器區開 diff 分頁 + 分支 worktree 衝突友善提示**（commit da63e65）— editorBus 加 openDiff；EditorGroup Tab 加 kind('file'|'diff')，diff 分頁渲染 DiffView（工作樹 vs HEAD），跳過 model 綁定/存檔；SourceControlPanel 點檔改 editorBus.openDiff（移除面板內 diff）。分支切換偵測 worktree 簽出衝突→友善提示。e2e diff-in-editor 綠。
- [x] **DF-6 PE-1/PE-2 增強**（見下）— dogfood 規劃的兩組增強，已實作交付。
- [x] **DF-7 終端機底色填滿 pane**（dogfood 回報：終端機四周留白框）— xterm 只能排整數 cols/rows，右/下剩餘空隙＋inset 邊距露出主題底色形成留白框；修法：`.pd-term-view` 容器底色漆成 xterm theme.background 同色（fit 邏輯不動、不重疊不裁列）。e2e terminal-fit-clip「容器底色＝xterm 背景色」綠。
- [x] **DF-8 已開終端機主題即時跟隨**（dogfood 回報：開著終端機切風格、終端機顏色不變）— 主題色原本只在掛載時讀一次；修法：MutationObserver 監聽 documentElement `[data-theme]` → 重讀 CSS var → 更新 `term.options.theme`＋容器底色（先 xterm 後容器，不脫鉤）。e2e terminal-fit-clip「切主題即時跟隨」真實 UI 路徑綠。

## 規劃增強（dogfood 提出、AskUserQuestion 定版範圍、ship 後交付）

- [x] **PE-1 git 線圖 GitLens 級互動**（F-7 增強；commit 011f2da）— ① Hover 卡片：commit 列指過去顯示完整訊息（subject+body）+ 作者/時間/完整 hash（`git:log` 加 `%b` → `GitLogEntry.body`）。② 右鍵選單：複製雜湊 / 複製訊息 / 開啟此 commit 變更（新 `git:show` → 編輯器 commit diff 分頁，重用 diff-in-editor）/ 簽出此 commit（detached + 確認）/ 從此 commit 建立分支（`git:branch` 加 startPoint）；皆 validateRef 擋注入。e2e git-commit-actions 綠。
- [x] **PE-2 Claude 多專案狀態強化**（F-8 增強；commit 6161db6）— ① 狀態文字標籤（badge 非 idle 顯示 執行中/待接手）。② 待接手桌面通知（monitor running→stopped-await → Electron Notification；可注入測試）。③ 狀態總覽計數（status bar useClaudeCounts 顯示 N 執行中·M 待接手）。e2e/單元（monitor 通知轉移）綠。

## Backlog（本輪不做）

- 真 PASS/FAIL 測試結果回報管道（D-TEST-REPORT，v1 用可觀測訊號）
- 初始登錄表外少見語言 LSP（D-LSP-MORE，按需加列）
- app 內建 Claude 對話面板（D-CLAUDE-PANEL）/ Claude 登入狀態指示（D-LOGIN-UI）
- app 內手動瀏覽網頁的內嵌瀏覽器（D-INAPP-BROWSER）
- 正式名稱命名（D-NAME，出貨前定）
- （deliver 過程動態發現的記這裡，footer 帶 Spotted:）

---

## 依賴分波（給多工用）

- **Wave 0（序列）**：P-1（先釘 `src/shared/ipc.ts`+`types.ts` 單一真相 + preload 全 API + router 樁 + StateStore + 單一實例 + 安全基線 + perf 埋點 helper）。
- **Wave 1（並行）**：P-2（renderer：layout/theme/activity/dialog host/settings）∥ P-3（main：workspace 模型）— conflictZone 一個純 renderer、一個純 main，零重疊。
- **Wave 2（並行）**：F-1（WorkspaceRail）∥ F-2（Explorer+FileWatcher）∥ F-3（Terminal+PTY）∥ F-4（Editor+fileService）∥ F-7（git）— 五者 conflictZone 互斥（F-2/F-4 同在 main/fs 但檔不同：FileWatcher.ts vs fileService.ts）。
- **Wave 3（並行）**：F-5（LSP，依 F-4）∥ F-6（搜尋跳檔，依 F-4）∥ F-8（Claude 監控，依 F-1+F-3）∥ F-10（dock 持久化，依 P-2）— 各寫各自 main/renderer 子目錄，無重疊。（F-9 已砍除，見上。）
- **Wave 4（X，ship 前序列為主）**：X-1 效能量測 → X-2 打包/更新 → X-3 a11y → X-4 安全硬化（X 多為跨檔稽核/量測，序列執行避免互踩）。
