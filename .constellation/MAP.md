<!-- constellation-map-synced-at: fe91716 -->
# Polydesk 專案現況地圖

## 模組索引

- `src/main/`：Electron 特權層。`ipc/router.ts` 註冊服務；`git/GitService.ts` 執行系統 Git；`git/gitSafeArgs.ts` 驗證 ref 與參數；`git/gitSerialQueue.ts` 序列化同 repository 操作；`git/cleanup/core/`、`git/cleanup/local/`、`git/cleanup/remote/` 與 `store/cleanup/` 提供零副作用 preview、完整 retained-ref/worktree/endpoint lease、本機 CAS、遠端 compare-and-delete、refspec producer 清理、repository instance identity、write-ahead journal、claim 重建及 quarantine。其餘模組負責 workspace、PTY、檔案、搜尋、LSP、AI 監控、狀態儲存與更新。
- `src/preload/`：固定白名單 IPC bridge，只暴露 namespaced API，不暴露 raw `ipcRenderer` 或 Node API。
- `src/shared/`：跨程序契約單一來源。`channels.ts` 定義 channel 白名單，`ipc.ts` 定義 request/response，`types.ts` 定義 Workspace、GitStatus、GitLogRef、GitWorktree 等模型。
- `src/renderer/`：React UI。`components/ActivityBar.tsx` 匯出水平 `WorkspaceToolbar`，由側欄 host 放在內容頂部提供檔案總管／搜尋／SCM／設定入口；`WorkspaceRail.tsx` 只管理工作區。`components/Help/` 提供 7 步首次導覽與可搜尋完整指南，`TitleBar.tsx` 與設定共用重開入口。`components/SourceControl/SourceControlPanel.tsx` 負責 SCM 的變更、歷史、分支與 stash；`components/Worktree/` 已有本地／遠端分支來源分流；`state/` 管理工作區、Git snapshot 與導覽匯流排；`theme/compactButtons.css` 提供無框小圖示按鈕樣式。
- `tests/` 與並置 `*.test.ts`：單元、整合與安全邊界測試；`e2e/` 以真 Electron、真 Git／bare remote、真檔案系統驗證完整鏈路。
- `specs/`：`requirements.md`、`design.md`、`architecture.md`、`tasks.md` 分別保存需求、安全／IPC 設計、架構與迭代歷程。部分舊架構路徑已漂移，使用前須對照實際程式。
- `build/`：圖示與 electron-builder 後處理；portable 產物輸出至 repository 外的 `../polydesk-dist/`。

## 主要資料流與邊界

- Git／SCM：`SourceControlPanel` → preload 固定 `git:*` channel → `GitService` handler → repository 共用序列佇列 → `execFile` 系統 Git → 結構化結果回 renderer。
- 完整清理：renderer → `git:cleanupPreview/Execute/Status/Cancel/Resume/ImportEvidence` 固定 IPC → repository queue → Git/磁碟/endpoint lease 重驗 → userData 版本化 journal/claim；preview 零副作用，execute 依序執行本機 worktree/ref/metadata，再處理遠端 expected-OID 與 tracking ref，部分結果沿 checkpoint 恢復。
- 工作區：renderer store／workspace rail → `workspace:*` → `WorkspaceManager` → `StateStore` userData 狀態檔。
- Worktree：SCM／建立對話框 → `git:worktree*` → `GitService` → `WorkspaceManager` 納管；分支互斥以 `git worktree list` 的即時結果為準。
- Terminal：xterm → `pty:*` → `PtyManager` → ConPTY；main 主動推播輸出。
- 檔案／搜尋／LSP：renderer 元件 → 對應固定 IPC → main service；檔案 watcher 再推事件回 renderer。

## Git 分支現況

- `GitService.branch(list)` 以 `for-each-ref` 讀取本地與 remote-tracking refs，再以實際 `git remote` 清單的最長前綴組成結構化 `{ remote, name, ref }`；因此合法的斜線 remote 不會被誤拆，並排除 remote `HEAD`。
- shared IPC 的 `git:branch` 支援 `list | create | checkout | delete-local | delete-remote`；list 同時保留既有扁平 `remotes` 相容 worktree 對話框，並提供 SCM 使用的 `remoteBranches` 結構化身分。
- SCM 分支頁分成本地與遠端兩個可獨立收合群組，顯示各自數量；每列 `⋯` 與右鍵共用選單，目前分支或 worktree 使用中的本地分支會顯示具名停用原因。
- 舊名稱式 `git branch -d`／`git push --delete` 產品入口已停用：本機先重驗 target/baseline/retained refs 與全部 worktree，遠端先重驗 effective push endpoint/expected OID，再由同一 journal 依序收斂；checkout 競態會恢復 local ref，remote tip／hidden ref 不確定則保留待辦。
- 刪除錯誤回傳結構化 code；顯示前會中和原始 Git 訊息的 bidi 與 C0 控制字元，不靠在地化 stderr 判斷未合併狀態。

## 已知缺口與地雷

- 完整清理的本機與遠端引擎已由共用 IPC/journal/UI 串接；恢復會驗 payload checksum 與 repository generation，quarantine 只接受 checksum 相符的證據匯入；仍須以完整出貨 runner 與 portable artifact 驗證本輪版本。
- remote 名本身可含 `/`，不可用第一個斜線拆 remote-tracking 顯示字串；應沿用結構化 `remoteBranches`。
- 遠端刪除可能因認證、網路、逾時、預設分支或保護規則被拒絕；失敗需結構化分類並顯示可行下一步，不得偽裝成功。
- `remotes` 是本機 remote-tracking snapshot；未 fetch／prune 時可能過期。現有 fetch 未帶 `--prune`。
- `remotes` 扁平欄位仍供既有 worktree 建立對話框使用；SCM 身分判斷不得退回依賴它。
- 導覽內容若因主要介面變動而失效，應調升 `ONBOARDING_VERSION` 讓舊完成狀態重新開始；一般功能新增、變更或移除則必須同步更新導覽與完整使用指南。

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

- portable 自解壓期間不建立靜態 BMP 視窗；完成自解壓並啟動 Electron 後，`src/main/window/splashWindow.ts` 只建立一個 420×230 的本機 `data:` 動畫開啟畫面。Electron 原生視窗建立後立即置中顯示，再載入品牌內容，主初始化等待原生 `show` 事件後才開始。視窗維持 sandbox、無 Node 整合、禁止外部導航且不設定最低停留時間。
- renderer 先載入工作區狀態再 render，`App` commit 後以固定白名單 `app:rendererReady` 握手；main 同時取得正確 webContents 的 `ready-to-show` 與 renderer-ready 才關閉 splash、顯示主窗並記錄 `window:interactive`。
- 啟動失敗時 splash 顯示具名原因並提供重試或退出；主視窗尚未 interactive 時，第二實例事件不會提前把隱藏主窗顯示出來。
- `e2e/perf.spec.ts` 的冷啟動 p95 3 秒門檻維持未放寬；既有環境豁免必須在出貨證據中明確記錄，不得把 splash 首次顯示當成可互動時間。
