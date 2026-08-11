# T-004 啟動畫面立即顯示
status: done
blocked-by:
zone: src/main/window/splashWindow.ts, src/main/window/portableSplash.test.ts, src/main/index.ts, e2e/splash.spec.ts, src/shared/releaseNotes.ts, build/portable-splash.bmp, package.json, package-lock.json, .constellation/MAP.md, README.md, CHANGELOG.md, specs/tasks.md

## 目標

使用者雙擊啟動 Polydesk portable EXE 後，自解壓階段就由既有品牌開啟畫面提供可見回饋；Electron 啟動後以同尺寸畫面接手，主視窗仍在真正可操作後立即交接，不增加最低停留時間，既有安全與失敗處理行為維持不變。

## 驗收條件

- [x] portable 封裝設定使用 420×230、24-bit RGB 的 Polydesk BMP，實際產物自解壓期間會顯示該 splash。
- [x] 真 Electron 冷啟動時，splash 建立完成便可見，不再等待既有 250 ms 門檻。
- [x] renderer-ready 尚未完成時主視窗保持隱藏且 splash 保持可見；就緒後 splash 關閉並只記錄一次可互動時間。
- [x] splash 仍維持 sandbox、無 Node 整合、禁止外部開窗，主畫面首次載入失敗仍可重試或退出。
- [x] README、CHANGELOG、迭代歷程與專案現況地圖同步雙層立即顯示的新行為；首次導覽與完整使用指南經檢查不受影響並留下驗證結果。

## 決議記錄

- 沿用既有 420×230 splash 的視覺與內容，只改顯示時序，避免把小型行為修正擴大成重新設計。
- 不設定最低展示時間，避免為了讓 splash 停留而增加冷啟動耗時。
- 真 Electron E2E 是能驗出 BrowserWindow 實際顯示時序與安全偏好的最低層，因此沿用既有 splash E2E 補回歸。
- DOM `domcontentloaded` 早於 Electron `loadURL()` Promise 完成，不能用該瞬間的 `isVisible()` 當穩定契約；改以主程序原生首次顯示埋點量建立到顯示耗時，並保留畫面可見性斷言。
- Electron 冷啟動首次建立 renderer 與載入本機 HTML 的耗時會受機器負載影響；原生 splash 視窗建立後先立即顯示深色背景，再載入品牌內容，主初始化則等待原生 `show` 事件後才開始。
- 實作確認必須讓主初始化等待原生視窗已顯示，因此 zone 擴及主程序啟動入口；依專案每批交付規則同步版本資訊、package lock 與發布文件。
- 使用者補充要從雙擊 portable EXE 起就看到完整畫面，因此加入封裝器層的原生 splash；這是 Electron 主程序啟動前唯一能提供畫面回饋的既有支援路徑。
- 實際啟動 `Polydesk-0.28.0-portable.exe`，以原生 HWND 直接擷取到 420×230 完整品牌 splash；暖啟動約 825 ms 出現，首次啟動仍可能先受 Windows 防毒／簽章檢查影響，該段發生在 portable 程序可顯示視窗之前。

## 驗證指令

- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false`
- `cmd /c npx vitest run src/main/window/portableSplash.test.ts --maxWorkers=1 --fileParallelism=false`
- `cmd /c npm run build`
- `cmd /c npx playwright test e2e/splash.spec.ts --workers=1`

## 驗證證據
- **2026-08-11T00:47:47.597Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.28.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/polydesk-dev[39m

     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m3 passed[39m[22m[90m (3)[39m
    [2m   Start at [22m 08:46:27
    [2m   Duration [22m 955ms[2m (transform 52ms, setup 0ms, collect 84ms, tests 5ms, environment 0ms, prepare 379ms)[22m


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
    [2m../../out/renderer/[22m[36massets/jsonMode-BmDy9HxS.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-BKUMaWfG.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-B1aaZYuM.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-Bc7xuuDf.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-C7i1-6iQ.js                                       [39m[1m[33m 9,446.91 kB[39m[22m
    [32m✓ built in 44.23s[39m

    ```
  - `cmd /c npx playwright test e2e/splash.spec.ts --workers=1`（exit 0）
    ```

    Running 3 tests using 1 worker

      ok 1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:32:5 › splash 內容載入後立即可見，主視窗就緒後立即收尾 (9.2s)
      ok 2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:86:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (6.6s)
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:102:5 › 主畫面載入失敗時可從 splash 確實退出 (8.3s)

      3 passed (24.7s)

    ```
  - 耗時：合計 94s｜cmd /c npm run typecheck -- --pretty false 8s｜cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false 7s｜cmd /c npm run build 49s｜cmd /c npx playwright test e2e/splash.spec.ts --workers=1 30s
  - sig: c4dcc0425416d5163a0f3af7f957ef5126ff3983319193141b63f890b4182b70
- **2026-08-11T00:50:54.269Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.28.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/polydesk-dev[39m

     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m3 passed[39m[22m[90m (3)[39m
    [2m   Start at [22m 08:49:11
    [2m   Duration [22m 1.14s[2m (transform 69ms, setup 0ms, collect 120ms, tests 5ms, environment 0ms, prepare 443ms)[22m


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
    [2m../../out/renderer/[22m[36massets/jsonMode-BmDy9HxS.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-BKUMaWfG.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-B1aaZYuM.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-Bc7xuuDf.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-C7i1-6iQ.js                                       [39m[1m[33m 9,446.91 kB[39m[22m
    [32m✓ built in 49.32s[39m

    ```
  - `cmd /c npx playwright test e2e/splash.spec.ts --workers=1`（exit 0）
    ```

    Running 3 tests using 1 worker

      ok 1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:32:5 › splash 視窗建立後立即顯示，主視窗就緒後立即收尾 (11.4s)
      ok 2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:86:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (7.3s)
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:102:5 › 主畫面載入失敗時可從 splash 確實退出 (16.9s)

      3 passed (36.3s)

    ```
  - 耗時：合計 125s｜cmd /c npm run typecheck -- --pretty false 15s｜cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false 8s｜cmd /c npm run build 57s｜cmd /c npx playwright test e2e/splash.spec.ts --workers=1 45s
  - sig: 52be378edb09f1a263ed6412619efeee4407da7cf7a8ea9812d0fe0028340766
- **2026-08-11T01:07:15.711Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.28.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/polydesk-dev[39m

     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m3 passed[39m[22m[90m (3)[39m
    [2m   Start at [22m 09:05:23
    [2m   Duration [22m 844ms[2m (transform 75ms, setup 0ms, collect 105ms, tests 5ms, environment 0ms, prepare 327ms)[22m


    ```
  - `cmd /c npx vitest run src/main/window/portableSplash.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/polydesk-dev[39m

     [32m✓[39m src/main/window/portableSplash.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 50[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m   Start at [22m 09:05:31
    [2m   Duration [22m 2.24s[2m (transform 217ms, setup 0ms, collect 436ms, tests 50ms, environment 0ms, prepare 502ms)[22m


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
    [2m../../out/renderer/[22m[36massets/jsonMode-M3CoP0Ah.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-BsPIaEAW.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-DdEGRa6a.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-CNeqeoWF.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-HP4Znz4H.js                                       [39m[1m[33m 9,446.91 kB[39m[22m
    [32m✓ built in 57.70s[39m

    ```
  - `cmd /c npx playwright test e2e/splash.spec.ts --workers=1`（exit 0）
    ```

    Running 3 tests using 1 worker

      ok 1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:32:5 › splash 視窗建立後立即顯示，主視窗就緒後立即收尾 (10.1s)
      ok 2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:86:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (7.1s)
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:102:5 › 主畫面載入失敗時可從 splash 確實退出 (5.8s)

      3 passed (24.4s)

    ```
  - 耗時：合計 128s｜cmd /c npm run typecheck -- --pretty false 11s｜cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false 7s｜cmd /c npx vitest run src/main/window/portableSplash.test.ts --maxWorkers=1 --fileParallelism=false 10s｜cmd /c npm run build 66s｜cmd /c npx playwright test e2e/splash.spec.ts --workers=1 34s
  - sig: f77d2039202ed6dc3ab645b401b3793075c50ed12a1bc6ef757bdc86c5c5b9eb
- **2026-08-11T01:10:27.666Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.28.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/polydesk-dev[39m

     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 4[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m3 passed[39m[22m[90m (3)[39m
    [2m   Start at [22m 09:08:50
    [2m   Duration [22m 744ms[2m (transform 45ms, setup 0ms, collect 80ms, tests 4ms, environment 0ms, prepare 295ms)[22m


    ```
  - `cmd /c npx vitest run src/main/window/portableSplash.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/polydesk-dev[39m

     [32m✓[39m src/main/window/portableSplash.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 7[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m   Start at [22m 09:08:54
    [2m   Duration [22m 498ms[2m (transform 33ms, setup 0ms, collect 64ms, tests 7ms, environment 0ms, prepare 134ms)[22m


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
    [2m../../out/renderer/[22m[36massets/jsonMode-M3CoP0Ah.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-BsPIaEAW.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-DdEGRa6a.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-CNeqeoWF.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-HP4Znz4H.js                                       [39m[1m[33m 9,446.91 kB[39m[22m
    [32m✓ built in 54.57s[39m

    ```
  - `cmd /c npx playwright test e2e/splash.spec.ts --workers=1`（exit 0）
    ```

    Running 3 tests using 1 worker

      ok 1 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:32:5 › splash 視窗建立後立即顯示，主視窗就緒後立即收尾 (9.9s)
      ok 2 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:86:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (6.8s)
      ok 3 ..\Users\ennvoy.lin\Documents\我的終端機\e2e\splash.spec.ts:102:5 › 主畫面載入失敗時可從 splash 確實退出 (6.2s)

      3 passed (23.5s)

    ```
  - 耗時：合計 113s｜cmd /c npm run typecheck -- --pretty false 11s｜cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false 5s｜cmd /c npx vitest run src/main/window/portableSplash.test.ts --maxWorkers=1 --fileParallelism=false 4s｜cmd /c npm run build 62s｜cmd /c npx playwright test e2e/splash.spec.ts --workers=1 31s
  - sig: ec900b1f126053d0dc3b64132d9f3670add1041ce5f1fcd12f090882c33774ef
- **2026-08-11T01:13:01.969Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```

    > polydesk@0.28.0 typecheck
    > tsc --noEmit --pretty false


    ```
  - `cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/Users/ennvoy.lin/Documents/我的終端機[39m

     [32m✓[39m src/shared/releaseNotes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 4[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m3 passed[39m[22m[90m (3)[39m
    [2m   Start at [22m 09:11:33
    [2m   Duration [22m 818ms[2m (transform 62ms, setup 0ms, collect 86ms, tests 4ms, environment 0ms, prepare 322ms)[22m


    ```
  - `cmd /c npx vitest run src/main/window/portableSplash.test.ts --maxWorkers=1 --fileParallelism=false`（exit 0）
    ```

    [1m[46m RUN [49m[22m [36mv3.2.6 [39m[90mC:/Users/ennvoy.lin/Documents/我的終端機[39m

     [32m✓[39m src/main/window/portableSplash.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 5[2mms[22m[39m

    [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m      Tests [22m [1m[32m1 passed[39m[22m[90m (1)[39m
    [2m   Start at [22m 09:11:37
    [2m   Duration [22m 506ms[2m (transform 29ms, setup 0ms, collect 65ms, tests 5ms, environment 0ms, prepare 142ms)[22m


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
    [2m../../out/renderer/[22m[36massets/jsonMode-M3CoP0Ah.js                                    [39m[1m[2m    29.12 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/tsMode-BsPIaEAW.js                                      [39m[1m[2m    40.32 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/freemarker2-DdEGRa6a.js                                 [39m[1m[2m    42.10 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/lspLanguageFeatures-CNeqeoWF.js                         [39m[1m[2m    61.69 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/addon-webgl-BEDhrLCz.js                                 [39m[1m[2m   139.86 kB[22m[1m[22m
    [2m../../out/renderer/[22m[36massets/index-HP4Znz4H.js                                       [39m[1m[33m 9,446.91 kB[39m[22m
    [32m✓ built in 48.48s[39m

    ```
  - `cmd /c npx playwright test e2e/splash.spec.ts --workers=1`（exit 0）
    ```

    Running 3 tests using 1 worker

      ok 1 e2e\splash.spec.ts:32:5 › splash 視窗建立後立即顯示，主視窗就緒後立即收尾 (9.9s)
      ok 2 e2e\splash.spec.ts:86:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (8.4s)
      ok 3 e2e\splash.spec.ts:102:5 › 主畫面載入失敗時可從 splash 確實退出 (7.5s)

      3 passed (26.5s)

    ```
  - 耗時：合計 101s｜cmd /c npm run typecheck -- --pretty false 9s｜cmd /c npx vitest run src/shared/releaseNotes.test.ts --maxWorkers=1 --fileParallelism=false 5s｜cmd /c npx vitest run src/main/window/portableSplash.test.ts --maxWorkers=1 --fileParallelism=false 4s｜cmd /c npm run build 54s｜cmd /c npx playwright test e2e/splash.spec.ts --workers=1 30s
  - sig: 184c9db84b644c7ebc03010b12d1a84750b4f71403d416c35317b8605c68742b
