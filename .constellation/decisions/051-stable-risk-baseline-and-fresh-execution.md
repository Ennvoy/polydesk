# 051 穩定風險基準與執行前重驗

## 背景

若以發起操作的 worktree `HEAD` 判斷「未合併」，同一條分支從不同工作區操作會得到不同結果；預檢後到執行前也可能被其他 Git 操作改變。

## 決定

安全刪除資格一律以目標分支 upstream（存在時），否則以主工作樹的目前 `HEAD`（刪除目前分支時為使用者所選切換目標）判定，不受發起畫面所在 worktree 影響。普通「安全刪除」不再依賴無 CAS 的 `git branch -d`：main 端先以 `merge-base --is-ancestor <target> <baseline>` 執行與 Git `-d` 對齊的安全資格判定，通過後才以 `update-ref --stdin` 同一 Git ref transaction 執行 `verify <baseline-ref> <baseline-oid>` 與 `delete refs/heads/<name> <expected-old-oid>`；未通過則開風險摘要，確認強制刪除後仍使用同一 transaction，只跳過 ancestry 資格。baseline 必須是具名 ref：upstream 用其 remote-tracking ref，主工作樹 `HEAD` 用當下簽出的 `refs/heads/*`；無法解成可 transaction verify 的具名 ref 就停止刪除，不降級為非原子重驗。

風險 commit 數的唯一定義為：「從目標 branch tip 可達，但從清理計畫完成後仍保留的任一 Git ref 都不可達」的 commit 集合基數。保留集合包含其他本地分支、未刪除的 remote-tracking ref、tag、stash、其他共用 refs，也必須逐一由各 worktree 列舉 `refs/bisect`、`refs/worktree`、`refs/rewritten` 等私有 refs；清理計畫將刪除的本地、remote-tracking 與 worktree-private refs 必須從保留集合排除。最後執行必須在 main 端同一 repository 佇列內重驗 branch tip、基準 SHA、每個 worktree 路徑／HEAD／完整 porcelain digest／lock 與遠端選擇；每一個不可逆步驟前再次重驗，任一變動即中止並要求重新確認。

## 原因

這個基準同時對齊 Git 安全刪除語意與真正的 commit 失去可達性風險，並避免使用者確認舊摘要後刪到已被其他程序更新的分支或資料夾。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出現行 `git branch -d` 與 `merge-base ... HEAD` 會依發起 cwd 漂移，且多次 renderer IPC 無法保證預檢到執行之間的新鮮度。
