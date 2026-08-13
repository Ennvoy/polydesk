# 074 保留 ref 集合的可達性租約

## 背景

風險 commit 數以清理後仍保留的 refs 計算；確認後若外部 Git 移動或刪除唯一保留某 commit 的 tag、stash 或 worktree private ref，target tip 不變也會使原摘要低估真正不可達數。

## 決定

風險分析建立完整 retained-ref lease：列舉 common refs 與每棵 worktree private refs，排除本計畫明確刪除者後，以排序的 `<full-ref, object-type, OID>` 集合產生 digest；符號 ref 另保存 expected target。集合與 digest 必須進入確認摘要基線、journal 與 recovery evidence。local target ref CAS 前，在 repository queue 內重新列舉並逐項比較名稱、型別、OID 與 symref target；新增、刪除或移動任何 retained ref 都回到 discovery，重新計算「完成後不可達」摘要並要求確認。

風險計數與 lease 使用同一個列舉 snapshot，不允許 UI 數字與執行租約各自讀一次。任何 private ref namespace 無法完整列舉或 object 無法 peel/traverse 時，沿用決議 073 的 unknown 語意並對遠端刪除 fail-closed。

## 原因

target/baseline 租約只能保證待刪分支沒變；把所有保留可達性來源也納入租約，才保證使用者看到的 commit 風險在真正刪 ref 時仍成立。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 tag、stash 或 worktree private ref 可在確認後改變，讓原可達差集失真。
