# 072 repository instance 世代與同路徑替換

## 背景

只用 canonical common-dir 路徑產生 fingerprint，無法區分原 repository 與同一路徑重新 clone/init 的新 repository；相同來源甚至可能有相同 branch/OID，使舊 journal 誤套新生命週期。

## 決定

首次建立 journal 時，Polydesk 在 userData identity registry 配發隨機 repository-instance generation，並綁定 canonical common-dir 的檔案系統 identity（至少 device/file-id 或等價不可由單純路徑重用的身分）與建立時 Git evidence digest。envelope、payload、claim index 與 remote receipt 都保存去密 repository fingerprint 加 instance generation；任何恢復或 endpoint 動作都必須同時匹配。

common-dir 路徑相同但檔案系統 identity 改變時一律視為新 repository instance，舊 journal/receipt 保留但永久停止自動執行，不得因 branch/OID 相同重新綁定。repository 移動但 identity 穩定時可在重新驗證 Git evidence 後更新去密位置映射。若平台無法提供穩定 filesystem identity、identity registry 損壞，或無法判斷是移動還是替換，就禁止對舊 journal 自動 reconciliation，要求人工匯入可驗證證據；不得以路徑、remote URL 或相同 OID 猜測。

## 原因

instance generation 把「這一個 repository 生命週期」納入租約，使同路徑替換與同內容重建都不會繼承舊的刪除意圖。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 common-dir 路徑 fingerprint 無法辨識同路徑重新 clone/init 的 repository 替換。
