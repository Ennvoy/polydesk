# T-009 側欄工具列歸位
status: done
blocked-by: T-006
zone: src/renderer/components/ActivityBar.tsx, src/renderer/components/WorkspaceRail.tsx, src/renderer/layout/panelRegistry.ts, src/renderer/theme/components.css, src/renderer/components/Help/GuidedTour.tsx, src/renderer/components/Help/HelpCenter.tsx, src/shared/constants.ts, e2e/shell.spec.ts, README.md, .constellation/MAP.md, .constellation/design-frozen.json, .constellation/decisions/010-branch-management-design-final.md, .constellation/decisions/078-branch-cleanup-ui-design-final.md, .constellation/decisions/079-sidebar-toolbar-placement.md, .constellation/decisions/080-sidebar-final-and-cleanup-dialog-unfreeze.md

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

讓檔案總管、搜尋、原始碼控制與設定入口貼近它們實際控制的側欄內容，工作區欄只承擔工作區管理，並保留所有既有狀態、無障礙與教學契約。

## 驗收條件（合成階段寫定，逐條可勾）
- [x] 工作區欄標頭只保留工作區名稱與新增入口，四個功能按鈕不再出現在工作區欄。
- [x] 側欄內容頂部依序顯示檔案總管、搜尋、原始碼控制與設定；前三者切換下方內容，設定仍開啟原對話框。
- [x] SCM 數量角標、active、tooltip、焦點與 `aria-pressed` 行為不退化，側欄縮窄時不溢出。
- [x] 首次導覽 selector／文案與完整使用指南同步新位置，介面結構變更會讓舊使用者重新看正確版本。
- [x] 真 Electron 外殼回歸證明新位置唯一且三視圖、設定、主題重啟鏈路仍可操作；使用者在開發版親自點過拍板後才定稿。

## 決議記錄（實作期小事自決落此，可追溯）

- 本票是使用者在 T-006 實作期間追加且明確指定的介面調整；依決議 079 採既有單一 `WorkspaceToolbar` 搬移，不複製第二份控制列。
- 使用者在隔離的本地 Electron 開發版檢視後選擇「1」，核准此版定稿並同時授權解凍第一階段分支清理對話框，以補上遠端清理明確 opt-in 契約；詳見決議 080。

## 驗證指令
- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm run build`
- `cmd /c npx playwright test e2e/shell.spec.ts --workers=1`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-08-13T09:22:53.002Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.29.0 typecheck
    > tsc --noEmit --pretty false


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
    [2m../../out/renderer/[22m[36massets/jsonMode-C-COKmq6.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-sKwJnknJ.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-369-_ID2.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-5PDCbdf3.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-DolzXmho.js                                       [39m[1m[33m 9,459.63 kB[39m[22m
    [32m✓ built in 50.62s[39m

    ```
  - `cmd /c npx playwright test e2e/shell.spec.ts --workers=1`（exit 0）
    ```

    Running 1 test using 1 worker

      ok 1 e2e\shell.spec.ts:6:5 › 外殼渲染 + 主題即時切換 + 重啟沿用 (REQ-E2E-007) (20.3s)

      1 passed (21.7s)

    ```
  - 耗時：合計 106s｜cmd /c npm run typecheck -- --pretty false 15s｜cmd /c npm run build 59s｜cmd /c npx playwright test e2e/shell.spec.ts --workers=1 32s
  - sig: 776470519ac5373ccae10a4817fe8d58481a60e16ddf0c50de11ddcaed8510d0
