# T-007 租約式遠端分支清理
status: open
blocked-by: T-005
zone: src/main/git/cleanup/remote/**, src/main/git/cleanup/remote/**/*.test.ts

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

讓所有伺服器分支刪除共用 live effective push endpoint discovery、expected OID compare-and-delete、tracking ref producer 分析與可恢復 receipt；不可見、離線、變更或多 endpoint 部分成功都不會被偽裝成完成。

## 驗收條件（合成階段寫定，逐條可勾）
- [ ] 只有使用者 opt-in 才連線；每個 remote 以 Git 的 effective push URL precedence 解析，pushurl 取代 url 並套用 rewrite，多 endpoint 個別遮罩顯示、確認、執行與回報，journal 不存 raw URL／credential。
- [ ] 遠端候選包含同名 branch 與實際 upstream 不同名 branch，實際 upstream 預選、其餘逐項未選；狀態未知不可選，使用者可取消遠端部分繼續本機清理。
- [ ] 每個 endpoint 動手前在 repository queue 內重驗 live tip、local branch/upstream、journal/receipt claims、refspec producer digest；任一 lease 變動或 server stale 回應都停在重新確認，不刪新 commit。
- [ ] hidden/permission/ambiguous 的讀取結果保持 unknown；只有 receive-pack delete 語意可證明成功或 absent，不能用一般 upload-pack 查無清除 receipt。
- [ ] remote-tracking ref 依完整 fetch refspec producer set 判斷，只自動清 `refs/remotes/*`；重疊、負 refspec、非 tracking namespace、未選 producer 或 unresolved mapping 均保留並納入可達性。
- [ ] tracking reflog、典型 remote HEAD symref、cleanup generation 與 expected-state 一致時才清；其他 symref、metadata 或 config 競態 fail-closed。
- [ ] 多 endpoint 部分成功與程序中止會逐步 checkpoint；離線重啟不阻塞 UI，成功項不重做、unknown 可重試、remote-only receipt 只有永久保留本機 refs 後才可與新本機計畫並存。
- [ ] shallow/partial/missing object graph 未能補齊完整遠端可達性時，伺服器刪除停用，本機清理仍可獨立完成。

## 決議記錄（實作期小事自決落此，可追溯）

- 多 endpoint、pushurl/rewrite、hidden/ambiguous 回應使用本機 bare remote 與受控 receive-pack helper 做真 Git 整合測試；不以 mock Git 取代協定行為。

## 驗證指令（可選；票級縮圈清單，weave 寫定——省略則 runner 跑 config 全量）
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 src/main/git/cleanup/remote`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
