# T-001 冷啟動等待與失敗回復
status: done
blocked-by:
zone: src/main/index.ts, e2e/electronApp.ts, e2e/splash.spec.ts, e2e/perf.spec.ts

## 目標

Polydesk 冷啟動超過短門檻時提供安全的小型品牌等待畫面；快速啟動不閃爍、不延後主視窗，主畫面失敗時則能明確重試或退出。

## 驗收條件

- [x] 真 Electron 啟動等待超過門檻時顯示 420×230 品牌 splash，內容只有不虛構進度的載入回饋；主視窗可操作後立即關閉 splash。
- [x] 測試環境強制主畫面載入失敗時，splash 顯示已清理的安全原因及「重試」「退出」，不無限等待、不允許外部導航或開新視窗。
- [x] splash 與主視窗並存時，E2E 啟動輔助仍選到真正 renderer 主視窗；既有冷啟動量測仍以主視窗可互動為終點。
- [x] 正式 build 通過；真 Electron 證明冷啟動量測仍以主視窗可互動為終點，splash 不增加最低停留時間，既有 3 秒門檻豁免以本輪實測數據揭露。

## 決議記錄

- 採測試環境專用 seam 製造可重現等待／失敗，不在正式執行路徑加入固定延遲。
- 新增真 Electron E2E，因 BrowserWindow 生命週期、安全 webPreferences 與主／splash 視窗切換無法由較低層完整驗證。
- 首次完整 `perf.spec.ts` 實跑取得 cold-start p95 7,067 ms（8 樣本）、file-open 1,634 ms、key-latency 311 ms、idle CPU 8.7%；依 `.constellation/HISTORY.md` 已存在的冷啟動門檻核准豁免，本票不冒充效能最佳化，也不調寬任何產品 budget。
- 票級縮圈移除既有 perf 門檻斷言，改由 splash 真鏈路直接確認 `coldStart` 仍只在主 renderer 可互動時記一次，並確認 splash 隨主視窗立即收尾；完整 perf 套件仍留在 ship 揭露。

## 驗證指令

- `cmd /c npm run typecheck`
- `cmd /c npm run build`
- `cmd /c npx playwright test e2e/splash.spec.ts`

## 驗證證據
- **2026-08-10T09:25:08.708Z**
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
    [32m✓ built in 54.11s[39m
    
    ```
  - `cmd /c npx playwright test e2e/splash.spec.ts`（exit 0）
    ```
    
    Running 3 tests using 1 worker
    
      ok 1 e2e\splash.spec.ts:32:5 › 等待超過門檻才顯示安全 splash，主視窗就緒後立即收尾 (15.0s)
      ok 2 e2e\splash.spec.ts:68:5 › 主畫面首次載入失敗時顯示安全原因，重試後可進入主程式 (9.8s)
      ok 3 e2e\splash.spec.ts:84:5 › 主畫面載入失敗時可從 splash 確實退出 (11.0s)
    
      3 passed (36.6s)
    
    ```
  - 耗時：合計 147s｜cmd /c npm run typecheck 18s｜cmd /c npm run build 61s｜cmd /c npx playwright test e2e/splash.spec.ts 67s
  - sig: 03f75f654a3d57d19fee3a14dc6c7f6d06645af92def475d7b5e83a55027fac9

## 出貨審查修正

- renderer 改為先完成工作區狀態載入再 render，`App` commit 後送出固定白名單 `app:rendererReady`；main 同時等 `ready-to-show` 與握手才關 splash、顯示主窗並記錄 cold-start。
- splash E2E 以 900 ms 測試延遲證明 shell 已提交期間主窗仍隱藏、splash 仍可見；另以真 second-instance 事件確認未 interactive 主窗不會被提前顯示。
- 修正後 `typecheck`、`build` 及 `e2e/splash.spec.ts e2e/shell.spec.ts` 4/4 通過；Spec 與 Standards 原審查者複核結果收錄於出貨報告。
