# T-002 工作區標頭導航與說明同步規則
status: done
blocked-by: T-001
zone: src/renderer/theme/tokens.css, AGENTS.md, CLAUDE.md, e2e/shell.spec.ts, e2e/activitybar-scm-badge.spec.ts

## 目標

移除固定占寬的最左活動列，讓檔案總管、搜尋、原始碼控制與設定從工作區標頭操作，並把導覽／說明同步納入後續功能完成定義。

## 驗收條件

- [x] 真 Electron 主畫面不存在舊活動列 DOM，工作區直接貼齊視窗左側；工作區標頭可見四個入口且分別保留 active、鍵盤焦點與無障礙名稱。
- [x] 真實點擊檔案總管、搜尋與原始碼控制會切換既有側欄，設定入口開啟既有設定對話框。
- [x] Git 工作區產生未提交變更後，移動後的原始碼控制入口仍顯示即時變更數 badge。
- [x] 專案 `AGENTS.md` 與 `CLAUDE.md` 明定所有使用者可見功能新增、變更或移除，必須同步更新或明確驗證導覽與使用說明不受影響。

## 決議記錄

- 定稿元件不列入 zone；本票只補整合契約、測試與專案規則，視覺以 design 定稿記錄 036 為準。

## 驗證指令

- `cmd /c npm run typecheck`
- `cmd /c npm run build`
- `cmd /c npx playwright test e2e/shell.spec.ts e2e/activitybar-scm-badge.spec.ts`

## 驗證證據
- **2026-08-10T09:37:03.615Z**
  - `cmd /c npm run typecheck`（exit 0）
    ```
    
    > polydesk@0.26.0 typecheck
    > tsc --noEmit
    
    
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
    [2m../../out/renderer/[22m[36massets/jsonMode-DeEADAgK.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-DoeMYVXR.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-BG0PpuBv.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-BHsdX0I5.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-Dx_8MnPy.js                                       [39m[1m[33m 9,443.71 kB[39m[22m
    [32m✓ built in 1m 26s[39m
    
    ```
  - `cmd /c npx playwright test e2e/shell.spec.ts e2e/activitybar-scm-badge.spec.ts`（exit 0）
    ```
    
    Running 2 tests using 1 worker
    
      ok 1 e2e\activitybar-scm-badge.spec.ts:21:5 › 切換工作區時 SCM 圖示顯示目前工作區的未提交檔案數 (1.1m)
      ok 2 e2e\shell.spec.ts:6:5 › 外殼渲染 + 主題即時切換 + 重啟沿用 (REQ-E2E-007) (51.3s)
    
      2 passed (2.0m)
    
    ```
  - 耗時：合計 270s｜cmd /c npm run typecheck 24s｜cmd /c npm run build 112s｜cmd /c npx playwright test e2e/shell.spec.ts e2e/activitybar-scm-badge.spec.ts 134s
  - sig: 41e30dc4079beaaa1a875b89043b431be234022c1bd12bf164a008371b802300

## 出貨審查修正

- Explorer／Search 的局部小圖示按鈕改用共用 `pd-compact-icon-btn`，由 `theme/compactButtons.css` 明確提供無框、游標、hover 與 focus 樣式，不再依賴已刪除活動列的 class。
- `e2e/shell.spec.ts` 新增實際 computed style 契約；修正後 `typecheck`、`build` 與 splash／shell 目標 E2E 4/4 通過。
