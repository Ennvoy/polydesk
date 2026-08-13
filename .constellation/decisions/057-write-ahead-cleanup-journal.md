# 057 完整清理 write-ahead journal 與啟動恢復

## 背景

完整清理包含多個無法作成單一檔案事務的步驟；若只在錯誤被觀察到後才寫 receipt，程序恰好在 ref 已刪、metadata 或遠端尚未處理時中止，待辦會永久失去入口。

## 決定

任何會修改 worktree 資料夾／Git 登記、local ref／metadata，remote-tracking ref 或伺服器 ref 的入口都必須先建立同一 schema 的 write-ahead journal；包含「只刪 worktree 資料夾保留 branch」、普通安全分支刪除、遠端列單獨刪除與完整清理，不以風險高低當作當機恢復的例外。第一個不可逆步驟前，main 端寫入 repository fingerprint、branch/baseline refs 與 OID、config/reflog/upstream snapshot、逐 worktree identity/digest/config.worktree snapshot、tracking ref/reflog/symref expected-state、endpoint expected OID、producer set 與 canonical refspec digest。journal 初始為 `prepared/no-side-effect`，經現況重驗確定仍零副作用時可取消；第一個不可逆步驟開始前必須先落盤為 `mutating`，之後每步完成立即快照。只有遠端刪除步驟可被使用者明確放棄；本地 ref metadata、worktree unknown／部分殘留與需人工處理狀態不得清除 journal，只能在真實狀態完成 reconciliation 後關閉。

Journal 使用版本化 schema、checksum 與寫臨時檔後原子取代；損壞、checksum 不符或未知新版 schema 移到 userData quarantine 並在 SCM 顯示人工檢查，不自動猜測執行。userData 唯讀或 journal 無法落盤時禁止開始新清理，但不阻擋 Polydesk 一般功能。Polydesk 啟動只同步 reconciliation 本機 Git／磁碟狀態後即顯示 UI；遠端 journal 以背景、每 endpoint 獨立逾時、禁止互動式認證的方式查詢，離線或逾時保留 unknown，不得卡住本機 UI。其餘步驟根據當下 Git refs、config、reflog、worktree 登記／路徑與 workspace state reconciliation：已達成的標成功，可安全重試的繼續，identity 變動或同名分支重建的停在需人工檢查。

## 原因

write-ahead journal 把當機、程序強關與網路回應遺失從「無法恢復的半殘」變成「可依真實狀態繼續的待辦」，也是一站式清理敢於跨資料夾、ref、metadata 與遠端的必要底線。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出現行決議只在已觀察到 metadata 或遠端失敗後寫 receipt，無法覆蓋不可逆步驟後、receipt 前的程序中止。
