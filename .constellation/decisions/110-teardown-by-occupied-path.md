# 110 刪除 worktree 時一併關閉仍佔用該資料夾的終端機

- 背景：決議 087 允許終端機分頁跨工作區搬移，且明定不改變 shell 的工作目錄。獨立審查指出，搬離 worktree 工作區的終端機，其 cwd 仍位於原 worktree 資料夾內，但 `PtyManager.killWorkspace(wsId)` 僅處理 `t.wsId === wsId` 的終端機——該終端機已不屬於原工作區。後續由 SCM 完整清理刪除該 worktree 時，`WorkspaceManager.teardownOnly` 會回報成功（該工作區確實已無終端機），但檔案 handle 仍被佔用，`git worktree remove --force` 因而失敗，錯誤訊息無從指向真因。此不變式（`WorkspaceManager.ts:208` 註解：「釋放檔案 handle，Windows 下 git worktree remove 才不 EBUSY」）在 087 之前是成立的。
- 決定：刪除 worktree 時，除該工作區名下的終端機外，**一併關閉「工作目錄仍位於待刪資料夾內」的終端機**，不論其目前歸屬於哪個工作區。清理流程照常執行，不因此另跳確認。
- 原因：該終端機所站立的目錄本就即將被刪除，保留它並無意義；而讓刪除以「無法解釋的失敗」告終，使用者需自行推理出「是那個幾天前搬走的分頁在擋」，實務上幾乎不可能。相對地「搬移時警告」無法真正解決失敗，只是把問題轉嫁給使用者記憶；「禁止搬移 worktree 工作區的分頁」則會把新功能鎖在使用者最常用的情境之外。代價為該分頁會被關閉，而使用者可能已不記得它與該資料夾的關聯。
- 證據：使用者於彈窗選擇「刪資料夾時順便把它關掉（推薦）」。當時依據為 `WorkspaceManager.ts:208-215` 的 teardown 不變式註解、`LocalCleanupExecutor.ts:142/149/161` 的三處呼叫點，以及 `PtyManager.ts:533` `killWorkspace` 依 wsId 過濾的讀碼確認。
