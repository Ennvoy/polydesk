<!-- constellation-map-synced-at: 6002a9fc83274fddeeb1c6fc14881fd13f5b2075 -->
# Polydesk 專案現況地圖

## 模組索引

- `src/main/`：Electron 特權層。`ipc/router.ts` 註冊服務；`git/GitService.ts` 執行系統 Git；`git/gitSafeArgs.ts` 驗證 ref 與參數；`git/gitSerialQueue.ts` 序列化同 repository 操作。其餘模組負責 workspace、PTY、檔案、搜尋、LSP、AI 監控、狀態儲存與更新。
- `src/preload/`：固定白名單 IPC bridge，只暴露 namespaced API，不暴露 raw `ipcRenderer` 或 Node API。
- `src/shared/`：跨程序契約單一來源。`channels.ts` 定義 channel 白名單，`ipc.ts` 定義 request/response，`types.ts` 定義 Workspace、GitStatus、GitLogRef、GitWorktree 等模型。
- `src/renderer/`：React UI。`components/SourceControl/SourceControlPanel.tsx` 負責 SCM 的變更、歷史、分支與 stash；`components/Worktree/` 已有本地／遠端分支來源分流；`state/` 管理工作區與 Git snapshot；`theme/` 提供共用樣式與色彩 token。
- `tests/` 與並置 `*.test.ts`：單元、整合與安全邊界測試；`e2e/` 以真 Electron、真 Git／bare remote、真檔案系統驗證完整鏈路。
- `specs/`：`requirements.md`、`design.md`、`architecture.md`、`tasks.md` 分別保存需求、安全／IPC 設計、架構與迭代歷程。部分舊架構路徑已漂移，使用前須對照實際程式。
- `build/`：圖示與 electron-builder 後處理；portable 產物輸出至 repository 外的 `../polydesk-dist/`。

## 主要資料流與邊界

- Git／SCM：`SourceControlPanel` → preload 固定 `git:*` channel → `GitService` handler → repository 共用序列佇列 → `execFile` 系統 Git → 結構化結果回 renderer。
- 工作區：renderer store／workspace rail → `workspace:*` → `WorkspaceManager` → `StateStore` userData 狀態檔。
- Worktree：SCM／建立對話框 → `git:worktree*` → `GitService` → `WorkspaceManager` 納管；分支互斥以 `git worktree list` 的即時結果為準。
- Terminal：xterm → `pty:*` → `PtyManager` → ConPTY；main 主動推播輸出。
- 檔案／搜尋／LSP：renderer 元件 → 對應固定 IPC → main service；檔案 watcher 再推事件回 renderer。

## Git 分支現況

- `GitService.branch(list)` 以 `for-each-ref` 讀取本地與 remote-tracking refs，再以實際 `git remote` 清單的最長前綴組成結構化 `{ remote, name, ref }`；因此合法的斜線 remote 不會被誤拆，並排除 remote `HEAD`。
- shared IPC 的 `git:branch` 支援 `list | create | checkout | delete-local | delete-remote`；list 同時保留既有扁平 `remotes` 相容 worktree 對話框，並提供 SCM 使用的 `remoteBranches` 結構化身分。
- SCM 分支頁分成本地與遠端兩個可獨立收合群組，顯示各自數量；每列 `⋯` 與右鍵共用選單，目前分支或 worktree 使用中的本地分支會顯示具名停用原因。
- 本地刪除只使用 `git branch -d -- <name>`；遠端刪除只使用 `git push <remote> --delete <branch>`。成功後會刷新 branch、snapshot、history 與 worktree 佔用狀態。
- 刪除錯誤回傳結構化 code；顯示前會中和原始 Git 訊息的 bidi 與 C0 控制字元，不靠在地化 stderr 判斷未合併狀態。

## 已知缺口與地雷

- 分支刪除沒有 `git branch -D` 強制路徑；若未來新增，必須另立需求、加強確認並覆蓋未合併 commit 遺失風險。
- remote 名本身可含 `/`，不可用第一個斜線拆 remote-tracking 顯示字串；應沿用結構化 `remoteBranches`。
- 遠端刪除可能因認證、網路、逾時、預設分支或保護規則被拒絕；失敗需結構化分類並顯示可行下一步，不得偽裝成功。
- `remotes` 是本機 remote-tracking snapshot；未 fetch／prune 時可能過期。現有 fetch 未帶 `--prune`。
- `remotes` 扁平欄位仍供既有 worktree 建立對話框使用；SCM 身分判斷不得退回依賴它。

## 終端機對話軸現況

- Claude alternate screen 無 xterm scrollback，現行 `claude:transcript` 會讀 `~/.claude/projects/<slug>/*.jsonl`，並保留 `user` 與 `assistant` 角色節點（`src/main/claude/sessionTranscript.ts`、`src/renderer/components/Terminal/TerminalView.tsx`）。
- Codex normal buffer 目前沒有角色化對話軸；畫面使用一般行導覽，會把 xterm 中每個非空白邏輯行都變成節點，因此模型長回覆會塞滿刻度。
- Codex rollout JSONL 有結構化 `event_msg/user_message` 與 `response_item/message` 角色事件，可建立使用者提問節點，不應從 ANSI／終端機文字猜角色。
- `TerminalPanel` 知道快捷啟動的是 Claude／Codex／Agy，但目前只保存 command 與顯示名稱，沒有把 AI 工具身分傳給 `TerminalView`；若要避免一般 PowerShell 誤套 Codex 對話軸，需補 term 級工具身分或等價的可靠程序對應。
- 新需求：Claude 與 Codex 的對話軸只顯示使用者文字，不顯示模型文字；需同步調整 shared transcript 模型、main readers、IPC、TerminalView、單測與 Electron E2E。
