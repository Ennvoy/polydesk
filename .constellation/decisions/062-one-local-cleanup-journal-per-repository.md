# 062 同 repository 同時只允許一份本機清理 journal

## 背景

同一 repository 內的兩份清理計畫可能共用 baseline、tracking ref 或 worktree，後啟動的計畫可以使先前已確認的資源集合失效。

## 決定

以 repository common-dir 去密 fingerprint 為鍵，同時只允許一份含任何本機變更的 `prepared` 或 `mutating` journal。已有 journal 時，新清理入口顯示「先繼續、取消零副作用的 prepared 計畫，或完成人工檢查」，不建第二份 journal。只剩遠端背景重試、且本機步驟已全達成的 receipt 可與新本機清理並存，但不得共用或刪除新計畫的 refs。

## 原因

單一本機 journal 是最簡單、可解釋的准入規則，不需要再建一套容易漏掉 Git 隱式資源的衝突集合鎖。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出同 repo 多份 active journal 可以互相破壞 baseline、tracking ref 與 worktree 前提。
