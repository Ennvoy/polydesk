# 068 損壞 journal 的 repository 歸屬與 quarantine 邊界

## 背景

若 repository fingerprint 只存在於 journal payload，payload checksum 損壞時就無法判斷應阻擋哪個 repository；直接移入 quarantine 也可能讓同 repo 立即開始第二份清理，失去單一 journal 保證。

## 決定

Journal 檔案以獨立 checksum 的最小 envelope 保存 schema 版本、journal id、repository 去密 fingerprint、payload checksum 與狀態；payload 另行 checksum。payload 損壞但 envelope 可驗證時，quarantine 記錄仍綁定該 fingerprint，並依決議 062 阻擋該 repository 的新破壞性清理。只要 envelope 表示 journal 曾進入 `mutating` 或無法證明零副作用，使用者的「封存」只會把項目移出一般待辦視圖，不釋放 repository claim；必須由可驗證的外部 pre/post-state 證據重建 payload 並完成 reconciliation，才可解除。只有完整證明仍為 prepared/no-side-effect 的 journal 才能取消並釋放 claim。

envelope 本身無法驗證或 fingerprint 無法可信歸屬時，Polydesk 保持一般功能可用，但全域暫停新的破壞性 Git 清理；UI 必須列出 quarantine 檔案與建立時間。人工確認只能封存顯示，不能解除全域阻擋；須匯入或重建足以可信歸屬且完成 reconciliation 的證據後才開放，不自動略過或猜測 repository。

Quarantine 與 active journal 共用 repository claim；把檔案移到 quarantine 或從一般視圖封存不等於釋放 claim。claim 索引的持久化與恢復以較新決議 071 為準。任何解除都要留下非敏感稽核紀錄，不儲存 repository 絕對路徑或 remote URL。

## 原因

把可信歸屬放在獨立 envelope，才能在 payload 損壞時仍維持 repository 級互斥；無法歸屬時全域 fail-closed，則避免靜默繞過未知的半完成清理。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出「損壞檔移到 quarantine」若沒有可靠 repo identity 與持續 claim，會使同 repository 再開新的清理 journal。
