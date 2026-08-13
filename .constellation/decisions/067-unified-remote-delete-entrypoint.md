# 067 所有遠端刪除入口共用同一條安全管線

## 背景

SCM 遠端分支列原本可直接呼叫 `git push <remote> --delete <branch>`；若完整清理才使用即時查詢、expected OID lease 與 journal，使用者仍可從舊入口繞過相同風險防護。

## 決定

任何刪除伺服器分支的入口都必須先進入決議 053、057、060、062 與 065 定義的共同管線，包含遠端分支列單獨刪除、完整清理中的附加遠端刪除，以及 journal 恢復重試。每個入口都要即時解析實際 push endpoint、查詢精確 ref、保存 expected OID、顯示 endpoint 與 branch、寫入 journal，再以 compare-and-delete 執行；不得保留直接名稱式 `push --delete` 的捷徑。遠端分支已不存在時依 desired-state 視為成功；查詢未知、OID 改變或跨 journal 衝突時停下並要求重新確認。

## 原因

刪除同一個伺服器 ref 的資料風險不因 UI 入口不同而改變；共用管線才能讓租約、恢復與衝突規則沒有旁路。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出既有遠端列刪除若維持直接 push，會繞過新設計的即時 discovery、expected OID 與 write-ahead journal。
