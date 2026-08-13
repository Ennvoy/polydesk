# 058 在途 Git 操作阻擋完整清理

## 背景

rebase、merge、cherry-pick、revert、bisect 與 sequencer 等操作可以把狀態放在各 worktree 的私有 Git 管理目錄，即使 porcelain 顯示工作目錄乾淨，刪除該 worktree 仍可能丟失一場未完成操作。

## 決定

預檢與每個不可逆步驟前都必須以 Git 命令解出每個 worktree 的 git-dir，偵測 merge、rebase、cherry-pick、revert、bisect、sequencer 與其他 Git 已知在途操作標記。任一在途狀態存在就阻擋完整清理，顯示操作名與 worktree 路徑，要求使用者先繼續或取消該 Git 操作；本版不提供強制繞過。

## 原因

在途 Git 操作的恢復資訊不等於一般 dirty 檔案，用同一個「丟棄未提交變更」核取來授權並不足夠。直接阻擋是最可預測且不會毀損 Git 狀態機的做法。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出現行 dirty digest 與 `worktree list --porcelain` 不會完整呈現這些 worktree-private 操作狀態。
