# 053 遠端清理才做即時精確查詢

## 背景

本機 `refs/remotes` 可能因尚未 fetch 或 prune 而過期，且現行分支清單沒有每條本地分支的 upstream 身分；若完整清理無條件先連所有 remote，本機清理反而會被網路失敗卡住。

## 決定

只有使用者勾選「連同刪除遠端」時，Polydesk 才對已設定 remote 以精確 branch ref 做即時查詢，不以過期 remote-tracking snapshot 當作伺服器真值。候選集合為：每個 remote 的 `refs/heads/<本地分支名>`，再加上該本地分支的實際 upstream `<remote, remoteBranchName>`，即使 upstream 名稱不同也必須查詢並可預選。每個 push endpoint 都要獨立即時查詢並保存 expected OID：remote 的 fetch URL、單一 push URL 或多 push URL 必須展開為可分別確認、執行與回報的 endpoint，不得對多 push URL 的 remote 直接執行一次名稱 push。執行刪除必須使用 expected OID lease 或等價 compare-and-delete，tip 變動即把該 endpoint 標為未完成並要求重新確認，不刪使用者未看過的新 commit。結果未知或重試時，若精確 endpoint 已查無該 ref，就以 desired-state 已達成視為成功並清 receipt；只有 endpoint 查詢失敗才繼續保留 unknown。

本機 remote-tracking ref 不與每個 push endpoint 一對一，實際映射與刪除契約一律以較新的決議 060 為準，不使用固定 `refs/remotes/<remote>/<branch>` 路徑。查詢成功且存在的 endpoint 分支才可勾選；無法查詢的 endpoint 標示「狀態未知」且不預選。使用者可取消遠端部分並繼續本機清理，不因遠端不可用而阻擋本機。

## 原因

精確即時查詢可避免漏掉未 fetch 的真實遠端或顯示已不存在的 stale ref；把網路範圍限在使用者明確 opt-in 後，則能保留快速且離線可用的本機清理。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出決議 048 的 remote 候選與 upstream 預選在現行結構化清單中沒有新鮮度與 per-branch upstream 資料來源。
