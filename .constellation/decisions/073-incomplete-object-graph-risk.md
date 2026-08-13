# 073 shallow／partial clone 的不完整 object graph 風險

## 背景

Shallow repository 會把 shallow commit 當作 traversal root；partial clone 或 promisor 缺失物件也可能使 ancestry/reachability 無法涵蓋伺服器完整歷史。單一 commit 數字因此可能低估遠端刪除後的資料損失。

## 決定

風險分析先探測 `rev-parse --is-shallow-repository`、partial clone/promisor 設定與 traversal 所需物件是否完整。完整 object graph 才顯示確定的「將失去 N 個 commit」；shallow boundary、promisor missing object、missing/corrupt object 或 traversal 不完整時顯示「至少 N 個本機可見 commit，完整數量未知」，不得顯示成確定總數。

本機分支清理可在專屬 unknown 風險確認後繼續，因為摘要已列出本機可證明的下限；任何伺服器 endpoint 刪除在 object graph 不完整時預設停用。只有該 endpoint 的 live tip 與完整遠端 graph 能被非互動方式取得、補齊並重新計算，才可重新啟用遠端刪除；查詢失敗時使用者仍可取消遠端部分完成本機清理。不得以 `--force` 或只確認 unknown 就刪伺服器 ref。

## 原因

把未知明確建模並對遠端採 fail-closed，可避免 shallow/partial clone 用看似精確但嚴重偏低的數字誘導刪除唯一伺服器歷史。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 shallow／partial clone 的 traversal 會漏掉本機不存在的祖先，原風險數可能低估遠端資料損失。
