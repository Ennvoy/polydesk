# Git Worktree 功能 — 規劃定案（backlog，待 /flow-spec 立項）

> 2026-07-02 與使用者以互動 mockup（`git-worktree-mockup.html`）拍板。本檔是規劃輸入，
> 非凍結 spec——立項時仍走 /flow-spec 訪談把邊界問乾淨（新實體，照規範走完整 spec）。

## 拍板結果（使用者已決）

| 決策 | 結論 |
|---|---|
| 定位 | **混合案**：底層走「worktree＝一種工作區」（可多個 worktree 同時各自開終端機/dev server/Claude），SCM 面板另加 `worktree` 分頁集中管理（列表/建立/移除/prune） |
| 建立入口 | **三個都要**：① SCM「分支」分頁滑過按鈕「⎇ 在新 worktree 開啟」② 工作區「＋」選單「從 Git 分支建立 worktree…」（對話框：repo→分支[可現有/現場新建]→位置）③ checkout 撞「已被其他 worktree 簽出」時錯誤提示升級為「跳到該 worktree」動作按鈕 |
| 存放位置 | **repo 旁 sibling**：預設 `<repo>-worktrees/<分支名 slug>`，建立對話框可改路徑 |
| 排程 | 先 `/flow-resume` 收尾現有 flow（驗證/出貨＋修 8 處 tasks.md↔ledger 對帳），之後 `/flow-spec` 立項本功能 |

## 設計要點（勘查結論，2026-07-02 架構地圖）

核心洞察：Polydesk 全系統（終端機 cwd、檔案樹、git、Claude 監控、持久化）都以
`workspace.path` 為軸——worktree 做成工作區後這些**零改動生效**。

必經接縫：
- **GitService**（`src/main/git/GitService.ts`）：新增 `git worktree list --porcelain -z` / `add <path> [branch]` / `remove <path>` / `prune`；沿用 `run()`＋`gitSerialQueue`；branch 過 `validateRef`；**worktree 目標路徑需要新的安全驗證**（現有 `withPathspecs` 是 pathspec 用，不適用）
- **IPC 契約**：`src/shared/ipc.ts` InvokeChannels ＋ `src/shared/channels.ts` INVOKE_CHANNELS 同步加 `git:worktree*`（漏列會被 compile-time 守門擋）；領域型別 `GitWorktree` 進 `src/shared/types.ts`
- **Workspace 模型**：`Workspace` 型別加 worktree 標記（如 `worktreeOf?: { repoPath, branch }`）；`WorkspaceManager.add` 目前只認既存資料夾→建立流程要先 `git worktree add` 再納入；`normKey` 去重對子目錄需正確
- **Rail UI**（`WorkspaceRail.tsx`）：worktree 工作區顯示 ⎇ 圖示＋縮排＋徽章（見 mockup 方案 A 頁籤）；「＋」改成選單（新增工作區/從分支建立 worktree）
- **SCM 面板**（`SourceControlPanel.tsx`）：第 4 分頁 `worktree`（列表/建立/移除）；分支分頁加滑過按鈕；`onCheckout` 的 worktree 衝突提示（`:296-304`）升級成動作
- **Teardown**：移除 worktree 工作區時多一個確認「同時 `git worktree remove` 刪資料夾？」；掛進既有 `workspaceLifecycle` / `PtyManager.killWorkspace`
- **持久化**：worktree 標記欄位進 `PersistState`（`types.ts`）＋ `schema.ts` normalize/migration（視需要升 schemaVersion）

REQ/task 對齊建議：新前綴 `REQ-WT-*`（或 `REQ-SCM-010+`）；task 編 `F-11`。

## Mockup

`specs/backlog/git-worktree-mockup.html` — 四頁籤：方案 A / 方案 B / 建立流程 / 資料夾位置。
使用者以此拍板；立項後 UI 定版仍照 /flow-spec 流程走 ui-ux-pro-max 正式 mockup。
