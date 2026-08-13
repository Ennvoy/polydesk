# 069 每個遠端 endpoint 刪除前重驗全部衝突

## 背景

多 endpoint 遠端清理可能執行很久；確認畫面之後，本地 branch/upstream、其他 journal 或遠端 tip 都可能改變。只靠 watcher 或執行前一次總體 preflight，後面的 endpoint 仍可能使用過期前提。

## 決定

每一個 endpoint 的 compare-and-delete 必須在 repository 共用序列佇列內、緊鄰網路刪除前重新讀取：目標 endpoint/ref 的 live OID、所有同 repository local branch 與 upstream 身分、active/quarantine journal claims、remote receipt 衝突集合，以及 canonical refspec/producer digest。任何值不同於該 endpoint 最近一次使用者確認的 lease，該 endpoint 就停在「需重新確認」，不得因其他 endpoint 已成功而沿用舊確認。重驗不依賴檔案 watcher 或 renderer snapshot；網路往返後若 compare-and-delete 回報 lease conflict，同樣保留 journal 並重新 discovery。

多 endpoint 依序各自套用此規則；某 endpoint 成功後立即持久化結果，下一個 endpoint 以更新後 journal 與當下 repository 狀態重新判斷。已不存在的精確 ref 仍依 desired-state 完成，但也必須先通過本地與 journal 衝突檢查，避免舊 receipt 對新生命週期自動結案。

## 原因

把衝突檢查放到每個不可逆遠端步驟的最後時刻，才能封住長流程中的 TOCTOU 視窗，並讓多 endpoint 的部分成功可安全恢復。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出一次性 preflight 與 watcher 都無法保證後續 endpoint 執行時仍符合原確認狀態。
