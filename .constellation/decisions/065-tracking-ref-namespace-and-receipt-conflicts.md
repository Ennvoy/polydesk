# 065 tracking ref namespace、metadata 與跨 journal 衝突

## 背景

fetch refspec 目標可以是本地分支、tag 或自訂 namespace，不能都當成可自動清除的 remote cache；舊遠端 receipt 也可能與新建同名 branch 衝突。

## 決定

自動 remote-tracking 清理只允許目標位於 `refs/remotes/*`；映射到 `refs/heads/*`、`refs/tags/*` 或其他 namespace 一律保留，需要各 namespace 本身的明示刪除流程才能動。刪 `refs/remotes/*` 時也必須以 cleanup-generation message 生成並驗證 phase-aware reflog，清除其 reflog，並列出所有指向它的 symref；只有典型 `<remote>/HEAD` 且仍精確指向待刪 ref 才允許同步以 expected target 清除，其他 symref 殘留就 fail-closed。

決議 062 的「只剩遠端 receipt」必須已永久標示保留所有未刪 local tracking refs，之後背景不得再刪本機 ref；否則仍算 local-mutating journal，不可與新本機計畫並存。endpoint fingerprint／remote branch 也納入跨 journal 衝突集合：重建同名 local branch、upstream 或新計畫重用同 endpoint/branch 時，舊 receipt 立即暫停並要求重新確認，即使 OID 恰好一樣也不自動刪。

## 原因

限制 namespace 可避免「清 remote tracking」繞過本地 branch/tag 的高風險防護；跨 journal 衝突則防止舊的 desired-state 在新生命週期裡過期執行。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 refspec 可映射到非 tracking namespace，remote-tracking 也有 reflog/symref metadata，且舊遠端 receipt 可誤刪新生命週期中剛建的同名遠端分支。
