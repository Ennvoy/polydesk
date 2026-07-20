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
- [x] **DF-9 同工作區終端機互相複製貼上＋總覽用量資訊校正**（2026-07-14 dogfood 回報）— 終端機原先只接受 `Ctrl+Shift+C` 複製，使用者在 A 選取後按一般 `Ctrl+C` 仍送出 SIGINT，導致切到 B 無內容可貼；修法：`Ctrl/Cmd+C` 先判斷 xterm 是否有選取，有選取才寫入系統剪貼簿，無選取仍交還 xterm 送出 SIGINT。總覽移除無法取得數值的 Agy 用量卡，但保留各工作區 Agy 執行狀態。vitest 快捷鍵判定 8 案例、terminal-clipboard e2e 5 案例（含 A→B 與 SIGINT）、overview e2e、typecheck、build 全綠。
- [x] **DF-10 Clone Repository＋外部 Git 狀態自動同步**（2026-07-14 dogfood 回報；commits 1013c23、2ba1d69）— 工作區新增流程補上 HTTPS／SSH Clone Git Repository，完成後直接納管並開啟。SCM 原本只監聽一般檔案變更，整合終端機或外部工具執行 commit / push 時只會改動被 watcher 排除的 `.git`，導致未推送數量停留在舊值；修法：面板可見且 repo 有效時每 5 秒執行低成本 status-only 探測，比對 `HEAD`、分支與 ahead / behind，只有狀態真的變化才完整刷新，視窗重新取得焦點時立即補查。歷史頁遠端 ref 改為固定寬度雲端圖示，並保留 tooltip 與 aria 名稱。GitService head 解析單測 14 案例、外部 push 自動歸零與遠端徽章 e2e、typecheck、build 全綠；完整 vitest 平行執行遇 Windows 資源競爭的 3 個測試檔，改以單 worker 重跑後 11 案例全綠。
- [x] **DF-11 終端機輸出跟捲自癒（claude 點「1 shell」展開後底部被吃掉）**（2026-07-14 dogfood 回報）— claude 等 TUI 開滑鼠追蹤（?1003/?1006，e2e 實測 activeProtocol=ANY）時滾輪事件被送給 TUI，viewport 無法用滾輪捲回；而 xterm 6 內部 `isUserScrolling` 旗標可能在「viewport 明明在底部」時被遺留成 true（選取拖曳自動捲動、resize/reflow 直接調 ydisp 幾何回底皆不碰旗標，且 xterm 所有清旗標路徑都掛 `ybase !== ydisp` 守門）→ 孤兒旗標讓下一波大量輸出（展開 Shell details 的重繪外溢）把 viewport 凍在原地、底部輸入框/狀態列消失在畫面下方。鍵盤輸入會意外自癒（echo 捲動開出落差後、下一鍵觸發 scrollToBottom 順帶清旗標），故只在「純滑鼠點擊展開、之後未按鍵」時發病——與 dogfood 操作完全吻合；直灌 PTY 探針實證凍結（viewportY 卡 72、baseY 跑到 134 持續 3 秒）。修法：TerminalView 自癒不變量「寫入前在底部 ⇒ 寫入後仍在底部」——PTY 寫入前記錄是否釘底，寫入完成後若漂移則 `scrollToBottom()`（公開 API 正路、順帶清掉孤兒旗標）；寫入前不在底部（使用者在讀 scrollback）完全不干預、不與使用者搶捲動。terminal-scroll-follow e2e 紅→綠（未修 build 先紅、含「捲上去讀舊輸出不被拉回」對照組）、終端機 e2e 全家桶 16 案例回歸綠、FileWatcher 既知負載 flake 單獨重跑 7 案例綠、typecheck、build 全綠。

- [x] **DF-12 發佈到 GitHub＋push 智慧補救**（2026-07-15 dogfood 回報：GitHub 還沒建 repo 時按 push 必失敗；AskUserQuestion 定版：gh CLI 機制＋發佈對話框＋push 錯誤分類＋自動 push -u 三件全包）— ① `shared/gitPublish.ts` 純函式驗證 repo 名稱（GitHub 字元集、擋 `-`/`.` 開頭旗標注入面、`.git` 結尾）＋資料夾名轉預設 repo 名。② `GitService.publishGitHub`：前置逐項檢查（是 repo→有 commit→無 remote→gh 存在→gh 已登入，各給人話 code）後 `gh repo create <name> --private/--public --source <ws> --remote origin --push` 一氣呵成；gh 走與 git 同款 execFile 白名單 env 硬化（`runBin` 泛化），Polydesk 不碰不存 token（REQ-SEC 現狀不變）；`POLYDESK_GH_BIN` 為 e2e 測試 seam。③ push 升級：失敗經 `gitErrorClassify` 分類（auth/network/timeout/no-remote/remote-not-found），「沒 upstream」不當錯誤、自動改跑 `push -u <remote> HEAD`（VS Code 同款）。④ `GitStatus.hasRemote`（upstream 缺席才多查一次 `git remote`）→ SCM 同步列無 remote 時以「發佈到 GitHub」取代 pull/push。驗證：gitPublish＋gitErrorClassify 單測 13 案、git-publish e2e 三案（全真 bare remote 自動 -u＋真實資料鏈路對賬、gh 缺席人話引導、Add-Type 編譯受控 shim 驗 gh 完整參數與成功 UI——僅外部 gh 邊界受控，比照 stubFolderPicker 慣例）、typecheck、build 全綠。
- [x] **DF-13 GitHub 私有 Repository 登入＋Clone**（2026-07-20 dogfood 回報：Clone 不會要求登入 GitHub，導致私有 repo 無法 Clone）— GitHub HTTPS URL 先檢查 `gh auth status`：已有帳號時以 `gh repo clone --no-upstream` 沿用私有倉庫權限；未登入仍先跑原生 Git，讓公開倉庫維持免登入。只有 GitHub 認證失敗才出現「使用瀏覽器登入 GitHub 並重試」，登入走 `gh auth login --web --clipboard` 官方 device flow，Token 留在系統憑證庫，Polydesk 不碰不存。驗證：GitHub URL 分流、gh 已登入 Clone、登入固定參數與認證錯誤分類單測；完整 Vitest 58 檔 517 案、typecheck、build、workspace e2e 4 案全綠。

## 規劃增強（dogfood 提出、AskUserQuestion 定版範圍、ship 後交付）

- [x] **PE-1 git 線圖 GitLens 級互動**（F-7 增強；commit 011f2da）— ① Hover 卡片：commit 列指過去顯示完整訊息（subject+body）+ 作者/時間/完整 hash（`git:log` 加 `%b` → `GitLogEntry.body`）。② 右鍵選單：複製雜湊 / 複製訊息 / 開啟此 commit 變更（新 `git:show` → 編輯器 commit diff 分頁，重用 diff-in-editor）/ 簽出此 commit（detached + 確認）/ 從此 commit 建立分支（`git:branch` 加 startPoint）；皆 validateRef 擋注入。e2e git-commit-actions 綠。
- [x] **PE-2 Claude 多專案狀態強化**（F-8 增強；commit 6161db6）— ① 狀態文字標籤（badge 非 idle 顯示 執行中/待接手）。② 待接手桌面通知（monitor running→stopped-await → Electron Notification；可注入測試）。③ 狀態總覽計數（status bar useClaudeCounts 顯示 N 執行中·M 待接手）。e2e/單元（monitor 通知轉移）綠。
- [x] **PE-3 版本可視化＋版本規則**（2026-07-15 使用者提出、AskUserQuestion 定版：跳 0.2.0／關於視窗＋狀態列版本＋CHANGELOG 版本分節＋README 徽章／每批交付 bump+tag）— ① `shared/releaseNotes.ts` 為版本顯示唯一來源（頂端＝目前版本），`releaseNotes.test.ts` 釘死與 `package.json` 同步（bump 漏改任一邊紅燈＝確定性閘門）。② 標題列新增「說明」選單 →「關於 Polydesk」（版本＋釋出日期＋近 3 版重點，走既有 dialog host）。③ 狀態列右下常駐版本鈕（點擊開關於）。④ CHANGELOG 改版本傘節（v0.2.0／v0.1.0），README 版本徽章。⑤ 版本釋出規則落 repo CLAUDE.md（每批交付：bump＋releaseNotes＋CHANGELOG＋徽章＋tag）。about-version e2e、releaseNotes 單測、typecheck、build 全綠。
- [x] **PE-4 未拉取數字提示＋事件驅動 fetch**（2026-07-15 dogfood 回報：遠端有新 commit 本地無感、必須手按 pull 才知道；AskUserQuestion 定版：不背景輪詢、僅「⟳ 手動重整」與「切工作區」兩個觸發點）— ① `GitService.fetch`：`git fetch` 走既有 `network()` helper（networkEnv 關互動提示＋GIT_NETWORK_TIMEOUT_MS），只更新 remote-tracking ref、不碰工作樹不合併；新 `git:fetch` IPC 進 per-wsId 序列佇列，與 push/pull 不互踩。② SCM 面板事件驅動觸發：⟳ 重新整理鈕順便 fetch（無冷卻；fetch 綠後自動 refresh 補 behind，不擋本地刷新先行）；切工作區 120ms 防抖刷新後 fetch（同 wsId 60s 冷卻 `FETCH_COOLDOWN_MS`，防連切狂觸網）；非 repo／無 remote 不觸發；自動路徑失敗靜默不蓋面板、手動路徑顯示小字提示（非錯誤橫幅）。③ UI：同步列 behind>0 顯示「↓N 未拉取」強調字（比照「↑N 未推送」）；pull 鈕右上角數字角標（沿用 `.pd-scm-count`）；⟳ 取回中沿用 is-loading 動態。驗證：GitService.fetch 單測（真 bare remote：遠端進新 commit→fetch→status.behind 0→1）、冷卻純函式單測、git-fetch-behind e2e（真實資料鏈路：bare remote 收真 push→⟳→同步列「↓1 未拉取」＋pull 鈕角標）、typecheck、build 全綠。

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

---

## 第二迭代：Git Worktree（2026-07-02 凍結立項；波次 [P-4]→[F-11]→[F-12]→[F-13]→[X-5]，序列——並行度自檢見 design §6.4）

- [x] **P-4 worktree 契約＋GitService 擴充＋持久化 schema v2**
      story：main 端具備完整 worktree 能力——`types.ts`/`ipc.ts`/`channels.ts` 釘 `GitWorktree`＋`git:worktree*` 四通道；GitService worktree list/add/remove/prune（argv 硬化＋序列佇列＋逾時，`--porcelain -z` 解析）；`worktreePath.ts` slug/路徑驗證純函式（≤60、Windows 保留名 `wt-`、序號、≤240 預檢、禁工作區內/系統目錄）；WorkspaceManager worktree 標記納管＋信任繼承；schema v2 遷移。
      reqRefs：REQ-WT-002/003/010/012/015、REQ-PERSIST-004
      blockedBy：—
      conflictZone：src/shared/ipc.ts、src/shared/types.ts、src/shared/channels.ts、src/main/git/GitService.ts、src/main/git/gitSafeArgs.ts、src/main/git/worktreePath.ts、src/main/workspace/WorkspaceManager.ts、src/main/store/schema.ts
      verify：vitest 全綠——slug 全規則（Windows 保留名/長度/序號/非法字元）、路徑驗證、porcelain 解析、schema v2 遷移、argv 硬化不變量、納管信任繼承單測。

- [x] **F-11 建立 worktree 全流程（入口②＋對話框＋納管開啟＋rail 識別）**
      story：工作區「＋」選單→「從 Git 分支建立 worktree…」→ 對話框（repo 預設當前、分支三來源＋validateRef 即時＋互斥標禁＋送出前複查、路徑預設 sibling 可改）→ 建立 → 自動納管（信任繼承、不重彈）→ 切換開啟 → rail 顯示 ⎇＋即時分支徽章緊列主工作樹下；失敗顯示原始錯誤＋自動清理半成品；remote 抓取失敗＋重試；資料夾衝突聰明處置（有效 worktree→加入、否則序號）。
      reqRefs：REQ-WT-001②/002/003/004/005（標禁複查）/010/011/013、REQ-E2E-012
      blockedBy：P-4
      conflictZone：src/renderer/components/Worktree/CreateWorktreeDialog.tsx、src/renderer/components/WorkspaceRail.tsx
      verify：Playwright REQ-E2E-012 全旅程綠（真 git fixture ≥2 分支；不重彈信任窗、cwd＝worktree、切回主 repo 終端機仍在）。

- [x] **F-12 SCM worktree 分頁（入口①＋列表/切換/移除/prune）**
      story：SCM 面板第 4 分頁 `worktree`：列出全部 worktree（即時分支/路徑/missing 狀態）＋空狀態說明 CTA；「切換到此」（未納管→lineage 驗證→提示加入並開啟）；「＋建立」重用對話框；移除→二選一彈窗（僅移出/連同刪除）→dirty 兩段確認（列變更數＋跑中程序）→teardown 先行等 handle 釋放→`git worktree remove`；「清理失效登記（prune）」。
      reqRefs：REQ-WT-001①/006/007/008/009/014、REQ-E2E-013
      blockedBy：P-4、F-11
      conflictZone：src/renderer/components/Worktree/WorktreePanel.tsx、src/renderer/components/SourceControl/SourceControlPanel.tsx、src/main/workspace/workspaceLifecycle.ts
      verify：Playwright REQ-E2E-013 全旅程綠（dirty＋跑中程序→兩段確認→teardown→資料夾成功刪、無 EBUSY 殘留、worktree list 無殘留；另驗僅移出保留資料夾）。

- [x] **F-13 分支分頁整合（入口①③：「在新 worktree 開啟」＋checkout 衝突跳轉）**
      story：分支分頁每分支 hover「⎇ 在新 worktree 開啟」（預填分支開對話框）；checkout 撞「已被其他 worktree 簽出」→ 錯誤提示升級為「跳到該 worktree」動作（已納管→切換；未納管→lineage 驗證→提示加入並開啟）。
      reqRefs：REQ-WT-001③/005、REQ-E2E-012（入口變體）
      blockedBy：F-11、F-12
      conflictZone：src/renderer/components/SourceControl/SourceControlPanel.tsx
      verify：Playwright 兩案例綠——分支分頁入口建立成功；衝突分支點擊→跳到對應 worktree 工作區。

- [x] **X-5 worktree 效能 budget＋整合回歸**
      story：REQ-PERF-005（`git worktree list`→分頁渲染 <300ms p95）、REQ-PERF-006（基準 fixture ≤1000 檔建立 <5s p95；不凍結謂詞獨立驗）程式埋點連續 30 次取 p95；全套 vitest＋worktree e2e 回歸。
      reqRefs：REQ-PERF-005/006
      blockedBy：F-11、F-12、F-13
      conflictZone：e2e/、tests/perf/
      verify：perf 數據落檔達標＋vitest/e2e 回歸全綠。
