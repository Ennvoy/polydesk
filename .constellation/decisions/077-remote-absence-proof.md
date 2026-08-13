# 077 遠端分支缺席必須由 receive-pack 語意證明

## 背景

Upload-pack discovery 可因 server hideRefs 看不到仍存在的 branch；把一般 `ls-remote` 查無直接視為 desired-state 成功，可能清掉 receipt 但伺服器分支仍在。

## 決定

「精確 ref 已不存在」只有在該 effective push endpoint 的 receive-pack advertisement 或等價、具刪除權限視角的原子 compare-and-delete 回應能證明 absent 時才成立。一般 upload-pack/`ls-remote` 查無、認證不足、server 隱藏、協定未 advertisement 或回應無法區分 hidden/absent，一律為 `unknown`，不得跳過 delete、清 receipt 或回報完成。

最可靠路徑為對精確 ref 送出 expected-old-OID 的 delete request：伺服器接受則成功，明確回報 old value 缺席且同一 receive-pack 視角可證明時視為 already absent，stale/hidden/permission/ambiguous 則保留 journal。Polydesk 不以空的讀取查詢結果替代寫入端證據；若服務端能力不足，本機清理仍可完成，遠端項目維持未完成或由使用者明確放棄。

## 原因

遠端「不可見」與「不存在」是不同狀態；用 receive-pack 刪除語意作證據，才不會對 hidden ref 產生永久假成功。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 uploadpack/transfer hideRefs 會使讀取 discovery 查無，但伺服器 branch 仍存在。
