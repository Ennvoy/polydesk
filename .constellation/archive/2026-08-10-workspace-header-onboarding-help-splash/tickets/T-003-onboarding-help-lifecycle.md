# T-003 首次導覽與完整使用說明生命週期
status: done
blocked-by: T-001
zone: src/shared/**, src/main/store/**, src/renderer/App.tsx, src/renderer/layout/DockLayout.tsx, src/renderer/state/**, e2e/onboarding-help.spec.ts

## 目標

以版本化持久狀態提供一次性的 7 步真介面導覽，並讓使用者隨時從說明或設定重新開啟導覽與可搜尋的完整產品指南。

## 驗收條件

- [x] 全新與 schema v2 狀態在主畫面載入後自動開始第 1 步；完成或略過後重啟不再自動出現，途中關閉則從同版已保存步驟接續。
- [x] 保存進度的導覽版本落後目前版本時從新版第 1 步開始；只有重大介面改版提升版本，小幅說明更新不觸發重播。
- [x] 導覽可上一步、下一步、略過或完成，並標示真實目標；缺少目標或小視窗時顯示不阻塞替代內容。
- [x] 導覽暫時顯示被隱藏的工作區、側欄、編輯器或終端機，結束時只撤銷導覽自己造成且未被使用者覆寫的顯隱變更。
- [x] 手動導覽每次從第 1 步開始，結束或中斷不改寫首次導覽狀態，也不在下次啟動自動接續。
- [x] 「說明」選單分別提供教學導覽、使用說明與關於；設定提供共用入口，使用說明可依分類與關鍵字搜尋一般使用者功能、畫面狀態、處理方式及安全導航。
- [x] 狀態 schema 遷移、壞值正規化、持久化 IPC 與真 Electron 首次／手動流程回歸通過。

## 決議記錄

- 完整指南不收錄建置、測試、打包與發布，這些維護內容只留在 README。
- 新增真 Electron E2E，因首次與手動導覽、Help 選單和重啟持久化是跨 renderer／IPC／磁碟的使用者流程。
- 定稿的 Help／Tour 元件不列入 zone；本票只完成狀態、版面協作與跨層驗證。

## 驗證指令

- `cmd /c npm run typecheck`
- `cmd /c npx vitest run src/main/store --maxWorkers=1 --fileParallelism=false`
- `cmd /c npm run build`
- `cmd /c npx playwright test e2e/onboarding-help.spec.ts`

## 驗證證據
- **2026-08-10T09:52:11.915Z**
  - `cmd /c npm run typecheck`（exit 0）
    ```
    
    > polydesk@0.26.0 typecheck
    > tsc --noEmit
    
    
    ```
  - `cmd /c npx vitest run src/main/store --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```
    
    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/Users/ennvoy.lin/Documents/我的終端機[39m
    
     [32m✓[39m src/main/store/StateStore.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 824[2mms[22m[39m
     [32m✓[39m src/main/store/schema.worktree.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 5[2mms[22m[39m
     [32m✓[39m src/main/store/schema.terminalFont.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
     [32m✓[39m src/main/store/schema.onboarding.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 4[2mms[22m[39m
    
    [2m Test Files [22m [1m[32m4 passed[39m[22m[90m (4)[39m
    [2m      Tests [22m [1m[32m28 passed[39m[22m[90m (28)[39m
    [2m   Start at [22m 17:49:14
    [2m   Duration [22m 3.71s[2m (transform 104ms, setup 0ms, collect 382ms, tests 837ms, environment 1ms, prepare 845ms)[22m
    
    
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
    [2m../../out/renderer/[22m[36massets/jsonMode-BApffeh0.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-CogCpcmC.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-l9HpzNEp.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-m1C1fe4T.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-DklQgClO.js                                       [39m[1m[33m 9,443.87 kB[39m[22m
    [32m✓ built in 57.03s[39m
    
    ```
  - `cmd /c npx playwright test e2e/onboarding-help.spec.ts`（exit 0）
    ```
    
    Running 4 tests using 1 worker
    
      ok 1 e2e\onboarding-help.spec.ts:33:5 › 首次導覽會保存進度、續接並在完成後不再自動出現 (45.5s)
      ok 2 e2e\onboarding-help.spec.ts:79:5 › schema v2 與舊導覽版本從第 1 步開始，缺少目標時提供不阻塞替代內容 (24.6s)
      ok 3 e2e\onboarding-help.spec.ts:107:5 › 說明與設定共用入口可搜尋完整指南，手動導覽不改寫首次狀態 (19.0s)
      ok 4 e2e\onboarding-help.spec.ts:151:5 › 導覽只還原自己顯示且未被使用者覆寫的區域 (12.5s)
    
      4 passed (1.7m)
    
    ```
  - 耗時：合計 194s｜cmd /c npm run typecheck 12s｜cmd /c npx vitest run src/main/store --maxWorkers=1 --fileParallelism=false 8s｜cmd /c npm run build 65s｜cmd /c npx playwright test e2e/onboarding-help.spec.ts 108s
  - sig: 43d802ea5c7bcb41fd97c5e7eb806fea076324bed60803047f0b357144408666

## 出貨審查修正

- 依使用者核准的 `decisions/038` 只解凍 `HelpCenter.tsx`，補上「AI 產生 commit 訊息」與「總覽與 AI 用量」文章，涵蓋 staged 前置、非自動提交、Agy 無用量卡與無資料／更新狀態。
- 新增真 Electron 搜尋斷言；修正後 `typecheck`、`build` 與 `e2e/onboarding-help.spec.ts` 4/4 通過，並已將 HelpCenter 重新凍結。
- Spec 原審查者複核為 0 blocker、0 suggestion，且確認 unfreeze→freeze 同意鏈符合規則。
