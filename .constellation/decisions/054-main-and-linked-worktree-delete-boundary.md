# 054 主工作樹與 linked worktree 的刪除邊界

## 背景

「目前分支」可能是主工作樹當前分支，也可能是正在使用的 linked worktree 當前分支；兩者不能都解讀成「刪除所在資料夾」。

## 決定

主 repository 資料夾永遠不得被分支刪除流程移除。同一目標分支同時由主工作樹與一個或多個 linked worktree 簽出時，固定順序為：先在主工作樹以預檢的 expected OID 與佔用清單重驗後切到使用者選取的其他本地分支；再逐一嚴格 teardown 並移除全部 linked worktree；最後才以 expected-old-OID CAS 刪目標 ref。主工作樹切換已成功但 linked worktree 步驟失敗時，主工作樹保留在新分支不自動切回，所有尚未移除的 linked worktree 與目標 ref 保留，並回報「切換已完成、清理未完成」供重試。

目標若正是當前 Polydesk linked-worktree 工作區，UI 不在後端清理前預先切離；嚴格 teardown 失敗或後續 Git 失敗且恢復成功時保持原工作區可見，恢復失敗時依決議 052 凍結成明確中斷狀態。只在本機清理成功且工作區已 delist 後，renderer 才重載清單並切到主工作樹或其他有效工作區，無其他工作區時落到 `activeWorkspaceId = null` 的空白狀態。

## 原因

主工作樹是 repository 的核心工作目錄，不應被 linked worktree 的移除語意帶走；對當前 linked worktree 延後到後端成功才切離，則能同時避免 renderer 指向已刪 cwd，也不會在實際什麼都沒刪成時把使用者無緣無故丟到空白畫面。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出決議 045、046 尚未分開從 linked worktree 看見主工作樹佔用分支，以及刪除當前 linked worktree 時的 UI 切換邊界。
