# Git 分支首案例總時限調整附錄

日期：2026-10-12。此附錄記錄首次出貨驗證失敗、單案例複核與限定測試調整，不能作為全量通過證據。

首次正式 ship 在 E2E shard 3/12 停止，首案例 `git-branch-management.spec.ts:50` 超過原總時限 `600000ms`；該 shard 為 `1 failed / 12 passed (18.0m)`。runner 採 first-red 停止，其餘 E2E shards 尚未完成。未簽章失敗記錄時間為 `2026-10-12T11:14:58.696Z`。

- 原始 log：`C:/Users/ennvoy.lin/AppData/Local/Temp/constellation-verify/0b9fd26c7067-ship.log`。
- root 保存的原始輸出：[first-ship-failure.txt](first-ship-failure.txt)。
- root 保存的 runner 失敗筆：[first-ship-failure.md](first-ship-failure.md)。

root 隨後單跑同案例，工具 session `77617` 回報 exit 0，輸出為 `ok 1 … (7.4m)` 與 `1 passed (7.4m)`。該次沒有另存 log 檔；此處引用 root 的工具紀錄，不宣稱有不存在的附件。單案例通過只能證明該次完整旅程通過，不能取代後續正式全量驗證。

本批僅調整首案例：總時限由 600 秒增為 1500 秒，涵蓋既有顯式逐步等待合計 1320 秒，再預留 setup／teardown 180 秒。每步 30／60／120 秒時限與斷言維持原值，讓案例總時限能涵蓋它已允許的逐步等待。`setup`、`profile/upstream`、`merged`、`remote`、`unfinished` 各段以薄層 `test.step` 包覆，`try/finally` 輸出毫秒耗時，成功或失敗都留下定位線索；原操作順序與清理流程保持。

本次實際驗證：

- `cmd /c npm run typecheck`：exit 0。此專案指令未包含 E2E 檔案。
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop --jsx react-jsx --types node e2e/git-branch-management.spec.ts`：exit 0，靜態檢查首案例所在 E2E 檔及其 imports。
- 靜態比較 HEAD 與修改檔：40 行既有斷言逐字相同（忽略新增縮排），其餘三個案例內容相同，僅首案例總時限變更。
- `git diff --check`：exit 0。

本次未啟動 GUI／E2E、未修改產品、其他測試、Playwright config 或 UI，亦未 commit、push、dist 或啟動全量 runner。正式全量結果須由 root 另行重跑與簽章。
