# v0.42.0 出貨證據：崩潰診斷與主視窗 renderer 復原（2026-10-22）

## 背景

- 使用者回報 Polydesk「閃退」。鑑識結果：主程序存活（重開機時 NSIS 啟動器仍在阻止關機），主視窗 renderer 異常結束後 frame:false 視窗只剩黑底、無法操作，外觀等同程式消失。以 `webContents.forcefullyCrashRenderer()` 重現。
- 歷史 Windows 當機報告（2026-07-11 v0.1.0、2026-07-22 v0.4.0）簽章相同：0xc0000409、資料 7、模組 Polydesk.exe 偏移 0x45e3515（Electron 33.4.11），無 minidump 無法追查。
- 程式此前沒有 crashReporter、沒有主程序 log。

## 改動

- `crashReporter.start({ uploadToServer: false })`，minidump 落在 `userData/Crashpad`。
- `src/main/diagnostics/diagnosticsLog.ts`：`userData/logs/main.log`，JSON 行、2 MB 輪替一代、寫入失敗吞掉、敏感 URL 憑證遮罩與 4096 字元截斷。記錄 `app:start`、`window:interactive`（含 coldStartMs）、`render-process-gone`、`child-process-gone`、`display-removed`、`app:before-quit`、`unhandledRejection`（記錄後以 nextTick 重新拋出，維持 Electron 預設錯誤框）。
- 主視窗 `render-process-gone`（非 clean-exit、非 quitting）：清除 Monaco 貼上焦點快取、重設 interactive 旗標、顯示既有失敗視窗並置頂，「重試」重新載入主畫面、「退出」結束程式。
- 「說明 → 開啟診斷記錄資料夾」（開 userData 根目錄）；HelpCenter 新增「畫面全黑或出現失敗視窗」一節。
- 新增 `e2e/renderer-crash-recovery.spec.ts`。

## 驗證

| 項目 | 結果 |
| --- | --- |
| `npm run typecheck` | 綠 |
| `npm test`（88 檔 744 項） | 742 綠；`FileWatcher.test.ts` 2 項紅，單獨重跑 9/9 綠（已知負載 flake） |
| `npm run build` | 綠 |
| e2e：renderer-crash-recovery、splash、app-close、onboarding-help、about-version、editor-clipboard | 全綠 |
| e2e：perf 冷啟動 p95 ≤ 3000 ms | **未達標，見下方環境豁免** |
| `npm run dist` | 綠，`..\polydesk-dist\Polydesk-0.42.0-portable.exe`（96,185,824 bytes） |
| portable 正常退出 | Polydesk.exe（含 crashpad-handler）11 秒內全部結束、解壓目錄清除、`logs/main.log` 含 app:start／window:interactive／app:before-quit、`Crashpad` 目錄存在 |

## 環境豁免（冷啟動 p95）

量測當下機器同時執行使用者的 Polydesk 0.41.0、多個 Claude／ffmpeg 工作，CPU 負載 2%～97% 波動。六輪結果：3036、5407、7097、8263、4570、14807 ms；單獨只跑冷啟動一輪 2772 ms（n=8，樣本 1707～2772 ms，負載約 30%）。未在同條件下對照 v0.41.0，因此無法排除新增 crashpad handler 子程序造成的啟動退步。使用者於 2026-10-22 明示接受此豁免出貨；下一批交付須在低負載下重跑 `e2e/perf.spec.ts` 冷啟動量測並補對照。

## 導覽與使用說明

- HelpCenter 已新增對應章節；GuidedTour 七步未涉及說明選單逐項，selector 未變，`ONBOARDING_VERSION` 不調升。
