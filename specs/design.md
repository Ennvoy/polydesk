# Design — 多工作區開發終端機（Polydesk）

> 本檔承接凍結需求 `specs/requirements.md` 與架構全景 `specs/architecture.md`，聚焦三件事：**UI 對焦結論**、**關鍵技術決策（選什麼／為什麼／不這樣會怎樣）**、**接縫契約（鐵則）**。並附 Decision Log 與資料／持久化 schema。
> 設計原則對齊 CLAUDE.md：深層客製化 UI（不吃框架預設）、安全基線優先、**model 當可抽換參數**、極簡實作。
> 所有 library 版本以 `package.json` 鎖定，研究結論時間戳 `asOf 2026-06`；對齊官方 docs 後再實作（2026 高頻迭代）。

---

## 0. 本檔在 Flow 的位置

- 上游：`requirements.md`（EARS 凍結）、`architecture.md`（ADR-lite + 路徑地圖）。
- 下游：`tasks.md`（垂直切片 + 依賴分波）讀本檔的接縫契約與技術決策切任務。
- 鐵則：任何 IPC 通道增刪、領域型別變更，**先改 `src/shared/ipc.ts` / `src/shared/types.ts` 單一真相**，再改 main/renderer 兩端。

---

## 1. UI 對焦結論（desktop-gui，web 技術 → mockup 具代表性）

### 1.1 品牌基底 slug（build 沿用其 tokens）

| 用途 | slug | 來源檔 | 沿用方式 |
|---|---|---|---|
| **基底（深色 / 淺色主題）** | `vercel` | `~/.claude/skills/flow-toolkit/references/design-systems/vercel/{DESIGN.md,tokens.css}` | engineering-as-design：achromatic 畫布、near-black 文字、單一飽和藍 accent、**shadow-as-border**（1px box-shadow 取代邊框）、Geist + Geist Mono。IDE 工具感與此最契合。 |
| **暖色主題** | `claude` | `~/.claude/skills/flow-toolkit/references/design-systems/claude/{DESIGN.md,tokens.css}` | literary salon：parchment（`#f5f4ed`，非純白）畫布、terracotta（`#c96442`）單一 accent、暖調中性灰、ring-based depth。 |

> **build 鐵則**：實作時 `tokens.css` 直接落地為三主題 CSS 變數（§1.4），元件全部 `var(--*)` 取值，**禁止**手刻 hex、禁止吃框架預設樣式（深層客製化：自畫 tab/headerbar）。深色主題由 vercel 的 shadow-as-border 哲學反相推導（near-black 畫布 + 微暖 near-white 文字），保留「depth 來自 shadow 分層、非 surface 變色」的精神。

### 1.2 畫面清單（Screens / States）

| # | 畫面 / 狀態 | 對應需求 | 重點 |
|---|---|---|---|
| S1 | **主工作台**（活動列 + 工作區列表 + 側欄 + 編輯區 + 底部終端機面板） | REQ-UI-001/002/003 | dockview 驅動，預設類 VSCode 版面 |
| S2 | **空狀態歡迎頁**（無工作區） | REQ-WS-007 | 大「新增工作區」CTA + 最近清單（若有） |
| S3 | **新增工作區流程**（開資料夾 dialog → 去重 → 根目錄/超大樹警告 → 信任確認） | REQ-WS-002/008 | 信任授權彈窗 |
| S4 | **工作區列表項**（名稱 + Claude 三態徽章 + hover/右鍵操作 + 拖曳排序 + 無法使用灰化） | REQ-WS-001/003/010, REQ-MON-001, REQ-WS-006 | 主狀態 = Claude 執行狀態 |
| S5 | **編輯器**（單檔 / 分割並排 / 缺 LSP 不擋路提示 / 外部修改衝突 / 編碼·換行列） | REQ-EDIT-* | 狀態列顯示 encoding/EOL/語言/LSP |
| S6 | **終端機面板**（多分頁 / 切 shell / 崩潰 exit code + 重啟 / 最大化） | REQ-TERM-* | |
| S7 | **原始碼控制面板**（變更樹 / diff / stage / commit / branch / history / stash / N-A 狀態 / init 引導） | REQ-SCM-*, REQ-MON-003 | |
| S8 | **全域搜尋**（串流結果 / 可取消 / 取代 / 點擊跳檔跳行高亮 / 截斷提示） | REQ-SEARCH-* | |
| S9 | **關閉確認彈窗**（有跑中程序時列出程序、要求確認） | REQ-TERM-007, REQ-E2E-008 | |
| S10 | **MCP 接線同意彈窗**（首次註冊 `polydesk-pw` 前的同意 + 衝突偵測提示） | REQ-PW-002 | AskUserQuestion 型 |
| S11 | **相依缺席提示**（git / Claude CLI / Playwright / 語言伺服器 未裝的不崩潰指引） | REQ-NFR-001, REQ-PW-006, REQ-EDIT-005 | |
| S12 | **設定 / 主題切換 / 匯出匯入** | REQ-THEME-*, REQ-PERSIST-005 | 深/淺/暖即時切換 |
| S13 | **一鍵重設版面** | REQ-UI-003 | dockview 還原預設 layout |

### 1.3 元件分解（Component Tree）

```
App (ThemeProvider · 三主題 CSS 變數注入)
└─ DockLayout (dockview · 可序列化樹狀 layout)
   ├─ ActivityBar            ── Explorer/Search/SourceControl/Settings 切換
   ├─ WorkspaceRail          ── 工作區列表（最上層切換軸）
   │  ├─ WorkspaceItem       ── 名稱 + ClaudeStatusBadge + 拖曳手柄 + hover 操作
   │  ├─ ClaudeStatusBadge   ── 三態：執行中(綠脈動)/已停待接手(琥珀)/未啟動(灰)
   │  └─ EmptyWelcome        ── 空狀態 CTA
   ├─ Explorer (FileTree)    ── 反映 FileWatcher 事件
   ├─ EditorGroup            ── 分割並排容器（共享 model）
   │  ├─ MonacoEditor        ── 深層客製化 theme + LSP client 掛載
   │  └─ EditorStatusBar     ── encoding / EOL / language / LSP 狀態 / 游標位置
   ├─ TerminalPanel
   │  ├─ TerminalTabs        ── 多終端機分頁 + 「＋」+ 關閉
   │  └─ XtermView           ── PTY 串流渲染（WebGL renderer）
   ├─ SourceControlPanel
   │  ├─ ChangeTree          ── staged/unstaged 變更樹
   │  ├─ DiffViewer          ── Monaco diff editor
   │  └─ CommitBox / BranchSwitcher / HistoryList / StashList
   ├─ SearchPanel            ── 串流結果 + 取消 + 取代
   └─ Dialogs                ── 信任確認 / MCP 同意 / 關閉確認 / 衝突 / 缺件提示
```

互動微狀態（每個互動元件須齊全）：Default / Hover / Active / Focus(aria + 可見 focus ring) / Disabled / Loading(skeleton) / Error。

### 1.4 設計 token（落地 CSS 變數；三主題）

> 取自 vercel（深/淺）與 claude（暖）的 `tokens.css`。下表為**語意對照**；實作時把對應 `:root` 區塊原文貼入 `src/renderer/theme/tokens.css`，以 `[data-theme="dark|light|warm"]` 切換。

| 語意 token | 淺色（vercel） | 深色（vercel 反相推導） | 暖色（claude） |
|---|---|---|---|
| `--bg` | `#ffffff` | `#0a0a0a` | `#f5f4ed`（parchment，非純白） |
| `--surface` | `#ffffff` | `#141414` | `#faf9f5`（ivory） |
| `--surface-warm` | = surface | `#1c1c1c` | `#e8e6dc`（warm sand） |
| `--fg` | `#171717` | `#ededed` | `#141413`（warmest near-black） |
| `--fg-2` | `#4d4d4d` | `#a1a1a1` | `#3d3d3a` |
| `--muted` | `#666666` | `#808080` | `#5e5d59` |
| `--meta` | `#808080` | `#4d4d4d` | `#87867f` |
| `--border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.1)` | `#f0eee6` |
| `--border-soft` | `rgba(0,0,0,.04)` | `rgba(255,255,255,.06)` | `#e8e6dc` |
| `--accent` | `#0070f3`（Vercel blue） | `#0070f3` | `#c96442`（terracotta） |
| `--accent-on` | `#ffffff` | `#ffffff` | `#faf9f5` |
| `--success` | `#16a34a` | `#16a34a` | `#17a34a` |
| `--warn` | `#eab308` | `#eab308` | `#eab308` |
| `--danger` | `#dc2626` | `#dc2626` | `#b53333`（warm crimson） |
| `--font-display`/`--font-body` | Geist Sans stack | Geist Sans stack | Anthropic Serif / Anthropic Sans |
| `--font-mono`（編輯器/終端機核心） | Geist Mono stack | Geist Mono stack | Anthropic Mono stack |
| `--radius-sm/md/lg/pill` | `6/8/12/9999` | `6/8/12/9999` | `8/12/16/9999` |
| `--elev-ring` | `0 0 0 1px var(--border)` | 同 | 同 |
| `--focus-ring` | `0 0 0 2px var(--accent)` | 同 | `0 0 0 3px rgba(56,152,236,.3)` |
| `--motion-fast/base` | `150ms/200ms` | 同 | 同 |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | 同 | 同 |

**Spacing**：兩套皆 4/8/12/16/20/24/32/48（4px grid）。IDE 高密度 chrome 以 `--space-1/2/3` 為主；面板內距 `--space-4`。
**Status 徽章映射**（REQ-MON-001）：執行中 → `--success`（脈動 `--motion-base`）；已停待接手 → `--warn`；未啟動 → `--meta`。
**ANSI 終端機調色盤**：xterm theme 自三主題 token 衍生（背景=`--bg`、前景=`--fg`、16 色 ANSI 另定一組與主題協調的常數，存 `src/shared/constants.ts`）。

### 1.5 互動流程（關鍵 journey 對齊 REQ-E2E）

1. **新增→切換工作區**（E2E-001）：歡迎頁 CTA → 開資料夾 dialog → 去重/警告 → 信任確認 → 加入列表 lazy（未實體化）→ 點選才實體化（<200ms 已載入）→ 切走後前一工作區 PTY/dev server 背景續跑。
2. **Claude×Playwright 接線**（E2E-004/010）：在工作區終端機跑 `claude` → app 已於 PTY 注入 `PLAYWRIGHT_MCP_CONFIG`（指向該工作區 config，含專屬 user-data-dir + headed）→ Claude 經 `polydesk-pw` MCP 開 headed 視窗 → 列表徽章轉「執行中」→ 切到另一工作區跑另一 `claude`，各用各自 profile 平行、互不干擾。
3. **缺 LSP 退化**（E2E-002）：開某語言檔 → serverProbe 探測不到 → 仍語法高亮 + 編輯/存檔 → 不擋路提示「缺 X，[一鍵安裝]/[顯示指令]」。
4. **外部修改衝突**（E2E-009）：開檔含未存檔編輯 → 磁碟被改 → 彈「重載磁碟版 / 保留我的編輯」，不自動覆蓋。

---

## 2. 關鍵技術決策（每條：選什麼 / 為什麼 / 不這樣會怎樣）

### (a) Dockable layout library 選型 + 版面序列化持久化
- **選什麼**：`dockview`（`dockview-react`，v4.x）作為唯一 dock layout engine。版面以其 `toJSON()` 序列化存 userData、`fromJSON()` 還原，提供「一鍵重設」回預設 layout。面板內容用 React component 經 `panelRegistry.ts` 注入並深層客製化（自畫 tab/headerbar，不吃預設樣式）。
- **為什麼**：原生支援 tab 拖曳重排、上下左右停靠、group/grid/splitview、面板 resize、floating + popout window，正好一次覆蓋 REQ-UI-002/003；zero dependency、TS 原生、bundle 最精簡、React adapter 一等公民；內建 layout serialize/deserialize 直接餵 REQ-PERSIST-003 做持久化與重啟還原；社群動能最高。popout window 對「Playwright headed 視窗 vs 主視窗」分屏觀看友善。
- **不這樣會怎樣**：自刻 dock/拖曳/序列化＝重造輪子、bug 多、persistence 難對齊；golden-layout 走舊式直接 DOM 操作與 React virtual DOM 衝突；flexlayout-react API 重、客製曲線陡；rc-dock floating/popout 與客製彈性較弱。
- **坑**：v3→v4 有破壞性變更，鎖 `package.json` 版本並對齊 dockview.dev 當前 API；序列化 JSON 即 StateStore 版面欄位的內容（§5），schema 遷移時須容忍 dockview 自身結構演進（還原失敗則 fallback 預設 layout、不 brick）。

### (b) Claude×Playwright 接線機制
- **選什麼**：三件套——(1) `claude mcp add polydesk-pw -s user -- npx @playwright/mcp@latest` 在使用者**全域**設定（`~/.claude.json`）註冊一次 user-scope MCP；(2) 每工作區一份獨立 **persistent profile**（`user-data-dir` 指向 app userData 下專屬資料夾）；(3) 每工作區終端機 PTY 啟動時**注入環境變數** `PLAYWRIGHT_MCP_CONFIG`（指向該工作區一份 config JSON，內含該工作區 user-data-dir + headed），讓同一份 user-scope MCP 在不同終端機各連對的 profile。MCP server 子程序繼承 claude（即工作區終端機）的環境，故 PTY 注入的 env 被讀到。
- **為什麼**：
  - **flags 順序**：flag（`-s user`）須在 server 名稱「之前」、`--` 之後接啟動命令，順序錯會解析失敗。
  - **profile 路由用 env 而非寫死**：本案要「每終端機不同 profile」，靠 PTY 注入 env 達成，而非註冊時 `-e KEY=VALUE` 寫死靜態值。
  - **config JSON 路徑最穩**：playwright-mcp 大多 CLI 選項有 `PLAYWRIGHT_MCP_` 前綴 env，但 `--user-data-dir` 對應的確切 env 名（推測 `PLAYWRIGHT_MCP_USER_DATA_DIR`）**需實機驗證**；保險法是注入 `PLAYWRIGHT_MCP_CONFIG` 指向每工作區一份 JSON（內含 user-data-dir + headed），最不受 env 名漂移影響。
  - **persistent 而非 `--isolated`**：`--isolated` 關閉瀏覽器即丟登入狀態，不適合需保留登入的工作區（REQ-E2E-010）；故用 persistent + 各自 user-data-dir。
  - **平行**：同一 persistent profile 同時只能被一個瀏覽器實例使用，各工作區各自 user-data-dir 才能平行（REQ-PW-005）；**嚴禁兩工作區共用同一 user-data-dir**。
  - **原子寫全域設定**：優先用 `claude mcp add` CLI 隔離 schema 漂移；若必須手改 `~/.claude.json`，走 read→parse→只 merge 單一 `polydesk-pw` key→temp+fsync+rename 原子寫+寫前時間戳備份+驗 JSON 可 parse（REQ-PW-002）。
  - **命名空間 + 衝突偵測**：穩定名 `polydesk-pw` + managed marker 供精準移除；註冊前偵測同名/同性質 MCP 衝突先彈窗（S10）。
- **不這樣會怎樣**：共用 profile → 併發衝突、登入互汙、無法平行；`--isolated` → 每次失去登入；寫死 env → 無法每終端機分流；裸寫 JSON 非原子 → 當機半寫毀掉使用者全域設定（破壞既有 MCP）；不偵測衝突 → 覆蓋使用者既有同名 MCP。
- **驗證待辦**：(1) 註冊後實測 `claude mcp list` 確認 user-scope 跨專案可用（已知某些版本有 bug，issue #32939）；(2) `PLAYWRIGHT_MCP_USER_DATA_DIR` env 名實機驗證，未證實前一律走 config JSON 路徑；(3) WSL shell 下接線到 Windows 側 Playwright 不保證（REQ-NFR-005），偵測到 WSL 明示不支援、不隱性失敗。

### (c) Claude 狀態偵測（程序掃描 + 輸出活動，strip ANSI）
- **選什麼**：`ClaudeStatusMonitor` 以**乾淨子程序查 process tree**（不刮終端機可見輸出做語意推測）判三態：**執行中**＝該 PTY 下有 `claude` 程序且最近有輸出/子程序活動；**已停·待接手**＝`claude` 程序在但停在提示等待輸入、或剛結束（含 exit code）；**未啟動**＝該 PTY 無 `claude` 程序。「最近有輸出活動」訊號取自 PTY data 事件的時間戳（**先 strip ANSI/escape**），但**程序存在性一律以乾淨子程序查詢**為準（`processProbe.ts`）。前景工作區即時更新，背景輪詢預設 5s、隨工作區數自適應放大間隔（REQ-MON-005/006）。
- **為什麼**：刮取可見輸出做語意推測脆弱（prompt 樣式變動即誤判、ANSI 干擾）；程序樹查詢確定性高。activity 只作「執行中 vs 待接手」的輔助訊號，存在性才是基準 → 兩者結合避免「程序在但卡住」被誤標執行中。
- **不這樣會怎樣**：純刮輸出 → 換 Claude 版本/主題即誤判；純看程序存在 → 卡在 prompt 也標執行中，使用者不知該接手。
- **資源有界**（REQ-MON-006）：背景輪詢用單一批次 process 查詢（一次列舉、比對各 PTY 的 child pid），間隔隨 N 放大；design 釘定門檻：N 個背景閒置工作區監控總 CPU 維持低水位（量測法：閒置 N=10 連續觀測，總額外 CPU 占用設上限，Phase 5 量測）。

### (d) LSP 通用橋接（monaco-languageclient + 語言登錄表 + 自動偵測）
- **選什麼**：`monaco-languageclient` v10.x，用內建 `LanguageClientsManager`/`LanguageClientWrapper` 管多個 client；`languageRegistry.ts` 維護副檔名→語言伺服器登錄表（初始：Python/Pyright、Go/gopls、Rust/rust-analyzer、C/C++/clangd、Java/jdtls、C#/C# server）；語言伺服器一律由 **main process spawn(stdio)**，透過 IPC/本機 socket 橋到 renderer 的 monaco-languageclient（MessageReader/Writer）。`serverProbe.ts` 在 main 對候選執行檔做 PATH 探測（Windows `where`/spawn 探測 `pyright-langserver`/`gopls`/`rust-analyzer`/`clangd`/`jdtls`；npm 類用 `npx --no-install` 檢查），偵測不到走 REQ-EDIT-005 降級 + 一鍵安裝。
- **為什麼**：v10 把 monaco-vscode-api 處理、language client、單編輯器 app 功能清楚分離，多 LSP 用內建 manager 即覆蓋 REQ-EDIT-003；main spawn(stdio) 集中特權、renderer 無 Node 能力符合安全基線；PATH 探測達成 REQ-EDIT-004/005「不靜默失敗」。
- **不這樣會怎樣**：自刻多 LSP 生命週期管理＝重造；renderer 直接 spawn LSP 破壞 sandbox 安全邊界；不探測 → 缺件靜默白屏。
- **坑（最大升級陷阱）**：(1) v10 深度依賴 `@codingame/monaco-vscode-api`，會「接管」monaco 部分服務，**不可混用舊裸 monaco bootstrap**，須照 v10 官方 wrapper 流程（v8→v10 破壞性大）；(2) **三方版本鎖定**：monaco-languageclient / monaco-vscode-api / monaco-editor 版本矩陣必須匹配，亂配白屏；(3) 與 Vite worker 設定耦合（見 (j) Monaco worker），須一起測。

### (e) git 安全硬化
- **選什麼**：所有 git 經 `execFile`（`shell:false`）+ **argv 陣列**呼叫系統 git；使用者輸入參數前置 `--`；commit message 走 `-F tempfile`（或 stdin）；branch/remote 名做格式驗證；唯讀監控操作加 `GIT_CONFIG_NOSYSTEM=1`、空 `core.hooksPath`、`core.fsmonitor=false`、`--no-pager`、不啟用不可信 textconv、尊重 `safe.directory`；同工作區 git 操作 `gitSerialQueue.ts` 序列化；網路類操作明確逾時（design 定值，§5 constants）。
- **為什麼**：argv + `shell:false` 杜絕命令注入（避免 shell 解析使用者控制的分支/檔名/訊息）；`-F tempfile` 避免 message 內容被當參數/注入；`GIT_CONFIG_NOSYSTEM` + 空 hooksPath 讓「唯讀監控」不觸發工作區內半可信的 hook/config（威脅模型 (i)）；序列化避免併發 git 互踩 index lock。
- **不這樣會怎樣**：`shell:true` 或字串拼接 → 惡意分支/檔名命令注入；直接傳 message 當參數 → 特殊字元破壞 argv；監控時跑工作區 hook → 半可信程式碼於監控時被執行（提權路徑）；不序列化 → `index.lock` 衝突、操作隨機失敗。

### (f) PTY / node-pty 打包
- **選什麼**：官方 `microsoft/node-pty` v1.x（Windows ConPTY）；以 `@electron/rebuild` 對 Electron ABI 重建原生模組；electron-builder 的 `asarUnpack` 列入 `**/*.node`、`node-pty`，確保 `pty.node`、`conpty.dll`/`conpty_console_list.node`、`spawn-helper`/`winpty*.dll` 落在 `app.asar.unpacked`（REQ-NFR-003）。可選 prebuilt 變體（`@homebridge/node-pty-prebuilt-multiarch` 或 `@lydell/node-pty`）省去本機 C++20 toolchain。
- **為什麼**：node-pty 是 real PTY（ConPTY）業界標準，與 xterm.js 天然搭配達 <50ms（REQ-PERF-004/REQ-TERM-005）；原生模組不 unpack 會在 asar 內無法 dlopen → 打包後終端機全掛。
- **不這樣會怎樣**：漏 asarUnpack → 安裝版啟動即「找不到 pty.node」；ABI 不對（Electron 升版未重跑 rebuild）→ 原生模組版本不符崩潰；用 prebuilt 但無對應 Electron prebuild → 仍得自編。
- **坑**：(1) node-pty 1.x build 需 C++20 編譯器，CI 須備 VS Build Tools/MSVC；(2) electron-builder 25.x 有 `asarUnpack` 多拖檔 bug，必要時用 afterPack hook 手動抽 spawn-helper 並補執行權限；(3) 鎖 Electron 版本前先確認 prebuilt fork 涵蓋該 Electron。

### (g) 狀態持久化 schema 版本 + 遷移 + 損毀備援
- **選什麼**：`StateStore` 寫 userData 單一 JSON（§5 schema），含 `schemaVersion` 欄位；`schema.ts` 提供版本→版本遷移函式鏈；所有寫入**原子**（temp+fsync+rename，當機半寫不壞檔）；讀檔失敗/JSON 不 parse/版本不識別 → 自動把壞檔備份（時間戳），以**預設啟動**（不 brick）；提供匯出/匯入（REQ-PERSIST-005）。
- **為什麼**：schema 會演進（dockview layout 結構、工作區欄位），無版本欄位無法安全遷移；原子寫 + 損毀備援對齊 REQ-PERSIST-004「不 brick」與 `.flow` 崩潰容錯精神。
- **不這樣會怎樣**：無版本 → 升版讀舊檔崩潰或資料錯位；非原子寫 → 關機半寫毀全部設定；無備援 → 一次損毀使用者所有工作區清單蒸發。

### (h) 編碼偵測（UTF-8 / Big5）與換行保留
- **選什麼**：`fileService.ts` 讀檔先偵測編碼（BOM 優先；無 BOM 用啟發式判 UTF-8 vs cp950/Big5，針對 Windows zh-TW 常見情境）；以原編碼解碼顯示、原編碼存回；提供「切換存檔編碼」；**偵測並保留原換行符 CRLF/LF**，存檔不擅改。
- **為什麼**：zh-TW 環境 UTF-8/Big5 混用，誤判即整檔亂碼或 `UnicodeDecodeError`（對齊 CLAUDE.md 編碼鐵則）；擅改 EOL 會在 git 製造整檔 diff 噪音。
- **不這樣會怎樣**：固定當 UTF-8 → Big5 檔亂碼；不保留 EOL → CRLF 專案被改成 LF，git 全檔變更、PR 不可讀。
- **實作建議**：偵測庫用成熟方案（如 `jschardet` + 自訂 zh-TW 權重，或 iconv-lite 解碼）；大檔走 large-file 模式只取前段偵測。

### (i) 安全基線（contextIsolation / sandbox / env 清洗 / 威脅模型）
- **選什麼**：renderer 強制 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`、`webSecurity:true`、`allowRunningInsecureContent:false`；preload 只用 `contextBridge.exposeInMainWorld('polydesk', api)` 暴露「一個 IPC 訊息一個方法」最小 API，**絕不**外洩 `ipcRenderer`/raw Node API；CSP 嚴設（含 `worker-src blob:` 供 Monaco worker）；禁 `webview`/`allowpopups`，攔 `will-navigate`/`setWindowOpenHandler` 外開連結。子程序環境清洗（`spawnEnv.ts`）：spawn git 等只傳白名單最小環境（PATH、USERPROFILE/HOME、SystemRoot…），主動剔除 `PLAYWRIGHT_MCP_*` 接線機密與無關 `GIT_*`；接線 env **只注入工作區終端機 PTY**，不外洩到 git/telemetry（REQ-PW-008、REQ-SEC-002）。**威脅模型**：把「工作區內執行的程式碼」視為**半可信對手**（加入工作區＝一次信任授權 REQ-WS-008）。
- **為什麼**：AD-1 不自建內嵌瀏覽器、不暴露無認證 CDP → 杜絕「工作區程式劫持已登入瀏覽器」；sandbox + contextIsolation 限制 renderer 即使被 XSS 也無 Node 能力；env 清洗防接線機密經 git/telemetry 外洩；git 硬化 (e) 防注入。
- **不這樣會怎樣**：`nodeIntegration:true`/無 contextIsolation → renderer 任何注入即取得 fs/spawn 全權；傳 `process.env` 全集給 git → 接線機密與無關變數洩漏、可被工作區 hook 讀取；不攔外開連結 → 釣魚/RCE 面。
- **坑**：`sandbox:true` 限制 preload 的 Node API，preload 需 Node 能力者改由 main 經 IPC 代理（設計時即分層）；contextBridge 非萬靈丹（v8 patch gap 下 isolation 仍可能被繞），故 renderer 載入內容須可信 + 嚴 CSP。

### (j) Monaco 在 Electron(Vite) 載入與 worker 設定（支撐 d、REQ-PERF-003）
- **選什麼**：Vite + `monaco-editor`，worker 走 Vite 原生 `?worker` import + 自設 `self.MonacoEnvironment.getWorker`（回傳對應 language worker：editor/ts/json/css/html worker），並設 `MonacoEnvironment={globalAPI:true}`。與 monaco-languageclient v10 + monaco-vscode-api 初始化**一起設定測試**。
- **為什麼**：少配 worker 會 fallback 到 main thread 拖慢、違反 REQ-PERF-003（開檔 <500ms）；`?worker` 是 2026 最穩做法、避免外掛黑箱；`globalAPI:true` 因 monaco ESM 自 0.22 起不自動掛全域 Monaco。
- **不這樣會怎樣**：worker 缺 → 大檔卡 UI、token 化慢；CSP 未允許 `worker-src blob:` → worker 載入失敗白屏；與 languageclient 各自為政初始化 → monaco-vscode-api 接管衝突、白屏。

---

## 3. 接縫契約（鐵則）

> **單一真相**：所有 IPC 通道的 request/response/event 型別集中在 `src/shared/ipc.ts`；所有領域型別集中在 `src/shared/types.ts`。main 與 renderer（經 preload）**共用同一份**。任何通道增刪、型別變更，**先改此二檔**再改兩端實作。通道名常數亦由此匯出（與架構 §3 的 `src/shared/channels.ts` 對齊；本設計將通道名與型別統一收斂到 `ipc.ts` 匯出，`channels.ts` 可作為 re-export 薄層或併入）。

### 3.1 `src/shared/ipc.ts` — IPC 契約骨架

```ts
// ── 通道分三類：invoke（請求/回應）、stream（PTY 高頻）、event（main→renderer 推播）──
import type {
  Workspace, WorkspaceInput, ClaudeStatus, GitStatus, GitChange, GitLogEntry,
  TermState, ShellKind, FileEncoding, Eol, SearchHit, LspServerInfo,
  LayoutJson, ThemeId, PersistState, McpWireResult, ConflictInfo,
} from './types';

/** invoke 通道：renderer 經 preload 呼叫、main `ipcMain.handle` 回應（一次性 Promise）。 */
export interface InvokeChannels {
  // 工作區管理
  'workspace:list':    { req: void;                 res: Workspace[] };
  'workspace:add':     { req: WorkspaceInput;       res: Workspace | { error: 'duplicate' | 'invalid' } };
  'workspace:remove':  { req: { wsId: string; purgeProfile: boolean }; res: { ok: true } };
  'workspace:rename':  { req: { wsId: string; name: string }; res: { ok: true } };
  'workspace:reorder': { req: { orderedIds: string[] }; res: { ok: true } };
  'workspace:activate':{ req: { wsId: string };     res: { ok: true } };           // 觸發 lazy 實體化
  // 檔案 / 編輯器
  'fs:read':           { req: { wsId: string; path: string }; res: { content: string; encoding: FileEncoding; eol: Eol; readonly: boolean } };
  'fs:write':          { req: { wsId: string; path: string; content: string; encoding: FileEncoding; eol: Eol }; res: { ok: true } | { error: 'permission' | 'conflict' } };
  'fs:tree':           { req: { wsId: string; dir: string }; res: { entries: { name: string; dir: boolean }[] } };
  // git
  'git:status':        { req: { wsId: string };     res: GitStatus };
  'git:changes':       { req: { wsId: string };     res: GitChange[] };
  'git:diff':          { req: { wsId: string; path: string; staged: boolean }; res: { patch: string } };
  'git:stage':         { req: { wsId: string; paths: string[]; staged: boolean }; res: { ok: true } };
  'git:commit':        { req: { wsId: string; message: string }; res: { ok: true; hash: string } | { error: string } };
  'git:push':          { req: { wsId: string };     res: { ok: true } | { error: string } };
  'git:pull':          { req: { wsId: string };     res: { ok: true } | { error: string } };
  'git:branch':        { req: { wsId: string; op: 'list' | 'create' | 'checkout'; name?: string }; res: { branches: string[]; current: string } | { ok: true } };
  'git:log':           { req: { wsId: string; limit: number }; res: GitLogEntry[] };
  'git:stash':         { req: { wsId: string; op: 'push' | 'pop' | 'list' }; res: unknown };
  'git:init':          { req: { wsId: string };     res: { ok: true } };
  // 終端機（控制訊息走 invoke；資料流走 stream）
  'pty:create':        { req: { wsId: string; shell: ShellKind }; res: { termId: string } };
  'pty:resize':        { req: { termId: string; cols: number; rows: number }; res: { ok: true } };
  'pty:close':         { req: { termId: string };   res: { ok: true } };
  'pty:list':          { req: { wsId: string };     res: TermState[] };
  // 搜尋
  'search:run':        { req: { wsId: string; query: string; opts: { regex?: boolean; caseSensitive?: boolean; replace?: string } }; res: { searchId: string } }; // 結果走 event 串流
  'search:cancel':     { req: { searchId: string }; res: { ok: true } };
  // LSP
  'lsp:probe':         { req: { langId: string };   res: LspServerInfo };
  'lsp:install':       { req: { langId: string };   res: { ok: true } | { error: string; manual: string } };
  // Playwright 接線
  'playwright:wire':   { req: { wsId: string };     res: McpWireResult };           // 首次經同意註冊 + 衝突偵測
  'playwright:status': { req: void;                 res: { registered: boolean; conflict?: ConflictInfo } };
  // 持久化 / 主題 / 版面
  'store:getState':    { req: void;                 res: PersistState };
  'store:setTheme':    { req: { theme: ThemeId };   res: { ok: true } };
  'store:setLayout':   { req: { layout: LayoutJson }; res: { ok: true } };
  'store:export':      { req: void;                 res: { json: string } };
  'store:import':      { req: { json: string };     res: { ok: true } | { error: string } };
  // 更新
  'update:check':      { req: void;                 res: { available: boolean; version?: string } };
  'update:install':    { req: void;                 res: { ok: true } };
}

/** stream 通道：PTY 高頻 binary chunk，建議走 MessageChannelMain/MessagePort 直連。 */
export interface StreamChannels {
  'pty:data':  { dir: 'main->renderer'; payload: { termId: string; chunk: Uint8Array } };
  'pty:write': { dir: 'renderer->main'; payload: { termId: string; data: string } };
}

/** event 通道：main 主動 `webContents.send` 推播；payload 一律帶 wsId 以路由面板。 */
export interface EventChannels {
  'claude:status':   { wsId: string; status: ClaudeStatus };                 // 三態徽章
  'git:statusUpdate':{ wsId: string; status: GitStatus };                    // 背景輪詢/即時
  'fs:change':       { wsId: string; path: string; kind: 'add' | 'change' | 'unlink' };
  'fs:externalEdit': { wsId: string; path: string };                        // 外部修改衝突
  'pty:exit':        { termId: string; exitCode: number };                   // shell 崩潰
  'search:result':   { searchId: string; hits: SearchHit[]; done: boolean; truncated: boolean };
  'workspace:lost':  { wsId: string };                                       // 資料夾遺失
  'update:progress': { percent: number; state: 'checking' | 'downloading' | 'ready' };
}

export type InvokeChannel = keyof InvokeChannels;
export type EventChannel  = keyof EventChannels;
```

### 3.2 `src/shared/types.ts` — 領域型別骨架

```ts
export type ThemeId   = 'dark' | 'light' | 'warm';
export type ShellKind = 'powershell' | 'cmd' | 'pwsh' | 'gitbash' | 'wsl';
export type FileEncoding = 'utf-8' | 'utf-8-bom' | 'big5' | 'utf-16le' | 'utf-16be';
export type Eol = 'crlf' | 'lf';

/** Claude 執行狀態（REQ-MON-001/002）。 */
export type ClaudeState = 'running' | 'stopped-await' | 'idle';   // 執行中 / 已停待接手 / 未啟動
export interface ClaudeStatus {
  state: ClaudeState;
  pid?: number;
  lastActivityAt?: number;   // PTY 輸出活動時間戳（strip ANSI 後）
  exitCode?: number;         // 剛結束時
}

export interface Workspace {
  id: string;                // 穩定 uuid
  name: string;              // 顯示名（預設資料夾名）
  path: string;              // 絕對路徑（去重鍵）
  order: number;             // 拖曳排序
  status: 'ok' | 'missing';  // 資料夾遺失 → missing（REQ-WS-006）
  defaultShell: ShellKind;
  trusted: boolean;          // 信任授權（REQ-WS-008）
  profileDir: string;        // 該工作區 Playwright user-data-dir
  hydrated: boolean;         // lazy 實體化狀態（執行期，不持久化）
}
export type WorkspaceInput = { path: string; name?: string };

/** git 狀態；無 remote/upstream/detached/新分支未 push → 對應欄位 null（顯示 N/A，REQ-MON-003）。 */
export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  changedCount: number;
  detached: boolean;
}
export interface GitChange { path: string; status: 'M' | 'A' | 'D' | 'R' | 'U' | '?'; staged: boolean }
export interface GitLogEntry { hash: string; author: string; date: number; subject: string }

export interface TermState { termId: string; wsId: string; shell: ShellKind; title: string; alive: boolean }

export interface SearchHit { path: string; line: number; col: number; preview: string }

export interface LspServerInfo {
  langId: string;
  available: boolean;
  command?: string;          // 偵測到的執行檔
  installable: boolean;      // app 能否一鍵裝（如 Pyright 經 npm）
  installHint?: string;      // 手動指令 + 官方連結
}

/** Playwright 接線結果（REQ-PW-002）。 */
export interface McpWireResult {
  ok: boolean;
  serverName: 'polydesk-pw';
  registered: boolean;
  conflict?: ConflictInfo;   // 同名/同性質 MCP 衝突 → 先彈窗
  error?: string;
}
export interface ConflictInfo { existingName: string; reason: 'same-name' | 'same-kind' }

/** dockview toJSON() 序列化產物（結構由 dockview 定義，視為 opaque）。 */
export type LayoutJson = unknown;

/** 持久化根狀態（§5 schema）。 */
export interface PersistState {
  schemaVersion: number;
  theme: ThemeId;
  workspaces: Omit<Workspace, 'hydrated'>[];   // hydrated 不持久化
  layout: LayoutJson | null;
  openFiles: { wsId: string; path: string }[];
  terminals: { wsId: string; shell: ShellKind }[];   // 配置記憶（不保證復活程序，REQ-PERSIST-003）
}
```

---

## 4. Decision Log（時間戳 2026-06-28）

| ID | 時間 | 決策 | 採用版本/library | 理由摘要 | 對應需求 |
|---|---|---|---|---|---|
| DL-01 | 2026-06-28 | dock layout engine = dockview | `dockview` / `dockview-react` v4.x | 原生 tab 拖曳/上下左右停靠/floating/popout + `toJSON`/`fromJSON` 直餵持久化；zero-dep、TS 原生、社群動能最高 | REQ-UI-002/003, REQ-PERSIST-003 |
| DL-02 | 2026-06-28 | Claude×PW 接線 = user-scope MCP + 每工作區 persistent profile + PTY env 注入 | `@playwright/mcp@latest`（鎖定）；`claude mcp add polydesk-pw -s user` | 同一份 MCP、不同終端機經 `PLAYWRIGHT_MCP_CONFIG` 連各自 user-data-dir，可平行、保留登入、零 repo 足跡 | REQ-PW-001/002/003/005 |
| DL-03 | 2026-06-28 | 全域設定原子寫 | read→parse→merge 單一 key→temp+fsync+rename+備份 | 防當機半寫毀 `~/.claude.json`、不破壞既有 MCP | REQ-PW-002 |
| DL-04 | 2026-06-28 | Claude 狀態偵測 = process tree 查詢 + activity 輔助（strip ANSI） | 自製 `processProbe` | 確定性高，避免刮輸出語意推測誤判 | REQ-MON-002 |
| DL-05 | 2026-06-28 | LSP 橋接 = monaco-languageclient v10 + 語言登錄表 + PATH 探測 | `monaco-languageclient` v10.x + `@codingame/monaco-vscode-api`（版本矩陣鎖定） | 內建多 LSP manager、main spawn(stdio) 集中特權、偵測不到走降級 | REQ-EDIT-003/004/005 |
| DL-06 | 2026-06-28 | git = 系統 git execFile 硬化 | system git via `execFile` | argv+`shell:false`+`--`+`-F tempfile`+`GIT_CONFIG_NOSYSTEM` 防注入/防監控觸發 hook | REQ-SCM-001/009, REQ-SEC |
| DL-07 | 2026-06-28 | PTY = node-pty(ConPTY) + asarUnpack + electron/rebuild | `node-pty` v1.x | real PTY <50ms；原生模組正確 unpack 才能打包啟動 | REQ-TERM-*, REQ-NFR-003 |
| DL-08 | 2026-06-28 | 編輯器 = Monaco + Vite `?worker` | `monaco-editor` 0.5x | VSCode 同源體驗；worker 達 <500ms 開檔；`globalAPI:true` | REQ-EDIT-*, REQ-PERF-003 |
| DL-09 | 2026-06-28 | 終端機渲染 = xterm.js | `@xterm/xterm` v5.x | 業界標準、WebGL renderer、與 node-pty 天然搭配 | REQ-TERM-005 |
| DL-10 | 2026-06-28 | 搜尋 = ripgrep 子程序串流 | `rg` 14+ | 最快、原生串流+忽略規則、可取消不卡 UI | REQ-SEARCH-* |
| DL-11 | 2026-06-28 | fs 監看 = chokidar | `chokidar` v4.x | 跨平台、glob 排除重目錄、背景低開銷 | REQ-MON-005 |
| DL-12 | 2026-06-28 | 打包/更新 = electron-builder NSIS + electron-updater(generic) | `electron-builder` 25+ / `electron-updater` 6.x | 自架 HTTPS 輪詢 latest.yml 差量更新；未簽章 SmartScreen trade-off 已記錄 | REQ-NFR-003/004 |
| DL-13 | 2026-06-28 | 殼層 = Electron 33+ / React 19 / TS 5 / Vite 6 | 同左 | 生態最成熟、跨進程共用型別、HMR 最快 | 全域 |
| DL-14 | 2026-06-28 | 安全基線 = contextIsolation+sandbox+env 清洗+半可信威脅模型 | Electron 安全旗標 | renderer 無 Node 能力、接線機密只進 PTY、工作區程式視為半可信 | REQ-SEC-001/002/003 |
| DL-15 | 2026-06-28 | UI 基底 token = vercel（深/淺）；暖色 = claude | design-systems `vercel` / `claude` | engineering 工具感（shadow-as-border、Geist）+ 暖色 literary（terracotta/parchment） | REQ-THEME-*, REQ-UI |
| DL-16 | 2026-06-28 | 持久化 = userData 單 JSON + schemaVersion + 遷移 + 原子寫 + 損毀備援 | 自製 StateStore | 安全演進、不 brick | REQ-PERSIST-004 |

**待實機驗證（不阻擋設計，build/verify 時關閉）**：
- V-1：`claude mcp add -s user` 跨專案可用性（issue #32939）→ `claude mcp list` 實測。
- V-2：`PLAYWRIGHT_MCP_USER_DATA_DIR` env 名是否成立；未證實前一律走 `PLAYWRIGHT_MCP_CONFIG` 指向 config JSON。
- V-3：WSL shell 接線到 Windows 側 Playwright 不保證（REQ-NFR-005）→ 偵測 WSL 即明示不支援。
- V-4：electron-builder 25.x `asarUnpack` 多拖檔 bug → 必要時 afterPack hook。

---

## 5. 資料模型 + 持久化 schema

### 5.1 userData 路徑

- 根目錄：Electron `app.getPath('userData')`（Windows 約 `%APPDATA%\Polydesk\`）。**不寫入任何使用者專案資料夾**（REQ-PERSIST-001）。
- 狀態檔：`<userData>/state.json`（主狀態，schema 見下）。
- 損毀備份：`<userData>/state.corrupt-<timestamp>.json`。
- 每工作區 Playwright profile：`<userData>/pw-profiles/<wsId>/`（即 user-data-dir）。
- 每工作區 MCP config：`<userData>/pw-profiles/<wsId>/mcp.json`（內含該工作區 user-data-dir + `headless:false`；由 PTY 經 `PLAYWRIGHT_MCP_CONFIG` 指向）。
- 全域 MCP 註冊：`~/.claude.json`（非 app 私有；只 merge `polydesk-pw` 單一 key、原子寫 + 備份）。

### 5.2 `state.json` schema（= `PersistState`）

```jsonc
{
  "schemaVersion": 1,
  "theme": "dark",                       // 'dark' | 'light' | 'warm'
  "workspaces": [
    {
      "id": "ws_01H...",                 // 穩定 uuid
      "name": "my-app",                  // 顯示名（可改名）
      "path": "C:/code/my-app",          // 絕對路徑，去重鍵
      "order": 0,                        // 拖曳排序
      "status": "ok",                    // 'ok' | 'missing'（資料夾遺失保留 + 灰化）
      "defaultShell": "powershell",      // 每工作區預設 shell
      "trusted": true,                   // 信任授權（REQ-WS-008）
      "profileDir": "pw-profiles/ws_01H..."  // 相對 userData 的 PW user-data-dir
    }
  ],
  "layout": { /* dockview toJSON() 產物，opaque；還原失敗 fallback 預設 */ },
  "openFiles": [ { "wsId": "ws_01H...", "path": "C:/code/my-app/src/index.ts" } ],
  "terminals": [ { "wsId": "ws_01H...", "shell": "powershell" } ]  // 配置記憶，不保證復活程序
}
```

### 5.3 schema 演進與備援規則

- **版本欄位**：`schemaVersion` 為整數；`schema.ts` 維護 `migrate(state, from, to)` 函式鏈，逐版升級。
- **遷移觸發**：讀檔時若 `schemaVersion < CURRENT` → 跑遷移鏈 → 原子寫回。
- **損毀備援**（REQ-PERSIST-004）：JSON 不可 parse / 缺必要欄位 / 版本不識別 → 把原檔 rename 成 `state.corrupt-<ts>.json` → 以**預設 state** 啟動（空工作區 → 顯示歡迎頁 S2），**不 brick**。
- **原子寫**：所有寫入走 temp 檔 + fsync + rename，避免關機半寫。
- **匯出/匯入**（REQ-PERSIST-005）：`store:export` 輸出 `state.json` 內容字串（可含/不含 profile 由選項決定）；`store:import` 驗 JSON + 版本相容後覆蓋，失敗回明確錯誤、不破壞現狀。
- **lazy 還原**（REQ-PERF-001）：重啟只還原工作區清單 + 版面 + 主題，工作區內容**被點到才實體化**（`hydrated` 為執行期狀態、不持久化）。

---

done
