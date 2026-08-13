# 071 journal claim 索引的落盤與自我修復

## 背景

Journal envelope 與 repository claim index 是不同檔案；各自原子取代不等於跨檔 transaction，當機可能留下有 journal 無 claim 或有 claim 無 journal。

## 決定

Envelope 是 claim 的權威事件來源，index 只作可重建快取。建立清理時固定順序為：先以新 generation 原子落盤 prepared envelope、fsync journal 目錄，再原子更新含 schema/checksum/generation 的 claim index、fsync index 目錄；兩者都成功後才允許進入 mutating。關閉時先把 envelope 原子標成 reconciled/closed 並 fsync，再更新 index；最後才可把 closed journal 移入稽核封存。

每次啟動與任何破壞性清理 preflight 都必須在接受新作業前，全量掃描 active 與 quarantine envelope，驗證 checksum/generation，重建 canonical claim set，再與 index 核對並原子修復。有 journal 無 index 時補 claim；有 index 無 journal、重複 generation、未知檔案或掃描不完整時 fail-closed，不自動釋放，轉人工證據重建。掃描與 index 更新由單一 app-process mutex 保護；多 Polydesk process 則使用 O_EXCL global claim lock，取不到鎖就禁止新破壞性清理。

## 原因

把 envelope 定義成單一真值並讓 index 可重建，能封住跨檔當機窗口；明確 write order 與 generation 也能區分未完成建立、正常關閉與損壞狀態。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 journal 與 claim index 不可能只靠各自 atomic replace 取得跨檔原子性。
