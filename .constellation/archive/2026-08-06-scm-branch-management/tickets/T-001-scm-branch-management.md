# T-001 SCM 分支分組與安全刪除
status: done
blocked-by:
zone: src/main/git/GitService.ts, src/main/git/gitErrorClassify.ts, src/shared/ipc.ts, src/shared/types.ts, src/main/git/GitService.branchDelete.test.ts, src/main/git/gitErrorClassify.test.ts, src/main/pty/PtyManager.test.ts, e2e/git-branch-management.spec.ts, e2e/app-close.spec.ts, vitest.config.ts

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

Polydesk 的 SCM 分支頁依定稿介面清楚區分本地與遠端分支，並讓使用者透過安全、語意明確且可驗證的流程刪除本機分支或遠端伺服器分支，不誤刪未合併工作、不跨 remote，也不把失敗偽裝成成功。

## 驗收條件（合成階段寫定，逐條可勾）

- [x] 真 Electron 分支頁同時顯示可獨立收合的「本地分支」與「遠端分支」、各自數量及正確清單，符合決議 002 與 UI 定稿 010。
- [x] 每個分支列的 `⋯` 與右鍵會開啟同一套操作選單；目前分支與由 worktree 使用中的本地分支仍顯示刪除項目，但停用並具名原因，符合決議 003、005。
- [x] 刪除已合併本地分支前顯示「只刪本機」確認；真 Git 僅做安全刪除，未合併分支會保留並顯示可理解原因，不存在強制刪除路徑，符合決議 001、004。
- [x] 刪除遠端分支前以危險樣式具名 remote 與 branch；真 bare remote 上的指定分支被刪除，另一個 remote 及本地同名分支維持不變，符合決議 001、004。
- [x] 非法 ref、目前分支、worktree 佔用、未合併、認證、網路、逾時、遠端不存在與伺服器拒絕均以結構化結果處理；失敗時清單不會先行移除。
- [x] 刪除成功後重新讀取分支、Git snapshot、歷史與 worktree 佔用狀態；本版不包含 Claude／Codex 對話軸變更，符合決議 009。

## 決議記錄（實作期小事自決落此，可追溯）

- 遠端刪除採 remote 與 branch 分欄傳遞，避免假定只有 `origin` 或把 remote-tracking ref 誤當伺服器操作。
- 本地未合併判斷以 Git ancestry exit code 分流，不解析可能被在地化的錯誤字串。
- Ship 首輪全量測試因 Windows 平行 Git／watcher／ConPTY fixture 資源競爭出現 9 個超時或時序失敗；失敗 7 檔改以單 worker 原範圍重跑 61/61 全綠，因此全量命令只降低併發、不縮小測試範圍。
- 使用者同意將 Windows 真實依賴測試的單案例與 hook timeout 從 25 秒調為 60 秒；只放寬測試框架容忍時間，不改產品執行或網路 timeout。
- Ship 全套 Electron E2E 單 worker 在 runner 每命令 600 秒上限內只完成 40/111（40 案全綠）；改為 3 個 shard、每 shard 2 workers，仍涵蓋全部 111 案且每條命令可獨立留下退出碼。
- Ship shard 使用 2 workers 時兩個 Electron 實例競爭 Windows 系統剪貼簿，既有 Ctrl+V 案例偶發失敗；改成 6 個 shard、每 shard 1 worker，避免共享 OS 資源互擾並維持全部 111 案覆蓋。
- 6 shard 的第 3 片因集中效能量測與真 Git 案例，在 15/16 全綠後撞上 runner 600 秒命令上限；改為 12 shard、每 shard 1 worker，維持全部 111 案並確保每條命令可在時限內完成。
- 既有 REQ-PERF-001 冷啟動 p95 在本次同機多 AI 負載下量得 3159、3335、6437 ms，均未達 `<3s`；使用者於 2026-08-06 明確選擇沿用 v0.18.0 的已知效能豁免直接發布。門檻與測試本身保持不變，ship gate 僅排除這 1 案，其餘 110 個 Electron E2E 完整執行。
- Ship 全量發現既有 app-close E2E 只點終端容器時，繁忙環境偶爾未把鍵盤焦點交給 xterm；改為等待 PTY 初始尺寸就緒並直接聚焦 helper textarea，隔離複驗 1/1 通過，不改產品關閉行為。
- 同機負載使單一完整 Vitest 命令超過 runner 600 秒上限；失敗範圍隔離重驗分支 6 案與 PTY 26 案共 32/32 通過。Ship 改成 6 個單 worker Vitest shard，完整覆蓋 574 案並避免每條命令逾時。
- Vitest shard 中 ConPTY 自然結束事件在約 16.5 秒才回報，越過案例內部 15 秒輪詢但未超過已核准的 60 秒測試上限；只將該 `onExit` 等待放寬到 30 秒，產品與其他 PTY timeout 不變。
- Spec 審查發現合法斜線 remote 會被 renderer 以第一個 `/` 誤拆；shared 改回傳結構化 `{ remote, name, ref }`，main 依實際 remote 最長前綴解析，真 Git 與 Electron 均新增 `team/backend` 精確刪除回歸，原審查者複審確認阻擋已解除。
- Standards 審查無阻擋級；依建議將所有 Git 原始錯誤先中和 bidi／C0 控制字元，並直接斷言本地安全刪除 argv 僅使用 `git branch -d --`、不存在 `-D`。

## 驗證指令（可選；票級縮圈清單，weave 寫定——省略則 runner 跑 config 全量）

- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npx vitest run src/main/git/GitService.branchDelete.test.ts src/main/git/gitErrorClassify.test.ts`
- `cmd /c npm run build`
- `cmd /c npx playwright test e2e/git-branch-management.spec.ts --workers=1`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-08-06T00:32:17.967Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.20.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npx vitest run src/main/git/GitService.branchDelete.test.ts src/main/git/gitErrorClassify.test.ts`（exit 0）
    ```
     [32m✓[39m src/main/git/gitErrorClassify.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 9[2mms[22m[39m
     [32m✓[39m src/main/git/GitService.branchDelete.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 30677[2mms[22m[39m
       [33m[2m✓[22m[39m GitService.branch 分支安全刪除[2m > [22m本地分支只使用 git branch -d 安全刪除 [33m 3768[2mms[22m[39m
       [33m[2m✓[22m[39m GitService.branch 分支安全刪除[2m > [22m拒絕刪除目前分支並回傳結構化原因 [33m 3119[2mms[22m[39m
       [33m[2m✓[22m[39m GitService.branch 分支安全刪除[2m > [22m拒絕刪除由其他 worktree 簽出的分支並回傳路徑 [33m 9526[2mms[22m[39m
       [33m[2m✓[22m[39m GitService.branch 分支安全刪除[2m > [22m未合併分支不提供強制刪除並回傳 unmerged [33m 5873[2mms[22m[39m
       [33m[2m✓[22m[39m GitService.branch 分支安全刪除[2m > [22m依 remote-tracking 名稱解析多 remote，且只 push-delete 指定遠端分支 [33m 6833[2mms[22m[39m
       [33m[2m✓[22m[39m GitService.branch 分支安全刪除[2m > [22m非法本地／遠端 ref 皆回 invalid，且不會成為 Git argv [33m 1555[2mms[22m[39m

    [2m Test Files [22m [1m[32m2 passed[39m[22m[90m (2)[39m
    [2m      Tests [22m [1m[32m14 passed[39m[22m[90m (14)[39m
    [2m   Start at [22m 08:29:37
    [2m   Duration [22m 35.86s[2m (transform 689ms, setup 0ms, collect 1.62s, tests 30.69s, environment 1ms, prepare 2.30s)[22m


    ```
  - `cmd /c npm run build`（exit 0）
    ```
    [2m../../out/renderer/[22m[36massets/redshift-CvYMMYZY.js                                    [39m[1m[2m    16.33 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/pgsql-DaSGFTLp.js                                       [39m[1m[2m    18.25 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/elixir-eLfY1jWH.js                                      [39m[1m[2m    18.74 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/postiats-CVVurEnu.js                                    [39m[1m[2m    19.30 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/powerquery-BQ_t1ZiQ.js                                  [39m[1m[2m    21.65 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/abap-D5KwWAsZ.js                                        [39m[1m[2m    22.97 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/solidity-yHOxYChb.js                                    [39m[1m[2m    26.03 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/jsonMode-C7ovHMLJ.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-BFN9wkxH.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-Bd0wzxFZ.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-BkiFVSP5.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-BLg5E8Is.js                                       [39m[1m[33m 9,422.20 kB[39m[22m
    [32m✓ built in 51.68s[39m

    ```
  - `cmd /c npx playwright test e2e/git-branch-management.spec.ts --workers=1`（exit 0）
    ```

    Running 1 test using 1 worker

      ok 1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\git-branch-management.spec.ts:45:5 › 分支管理：本地／遠端分組、雙入口、阻擋原因與安全刪除真鏈路 (54.0s)

      1 passed (55.0s)

    ```
  - sig: fc427f920b6eb1b8f094de2c8ef62b6e24149b6652bc14947a3ddfb17eb7d1c5
