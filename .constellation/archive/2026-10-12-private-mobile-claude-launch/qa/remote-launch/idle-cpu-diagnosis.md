# 閒置 CPU 失敗診斷與最小監控修正

## 原始與重現結果

正式 full 第二輪在 REQ-MON-006 正常 first-red 停止，量測為 main 單核 CPU 14.322%，10 個工作區、18 秒視窗，要求低於 10%。主代理已保留該輪原始錯誤、perf report 與 runner failure。該輪前面的 unit、build、E2E 1–5 成功，但此輪仍不是 full green。

限定診斷先完全不改產品與原測試，實跑原 `e2e/perf.spec.ts` 的 REQ-MON-006 一次，再次失敗：10.244444444444445%，10 個工作區、18,000ms、原 1,500ms 初始化等待、原 10% 門檻，exit 1，個案 39.5 秒／程序 42,403ms。原始檔 `idle-cpu-original-repeat.txt/json` 與 `idle-cpu-original-repeat/perf-report.json`，沒有重試篩選 passing 結果。

## 真實 main profile 與原始呼叫計數

獨立第二個 fixture 使用同一 `launchApp`、資料夾選擇 stub、工作區 UI 新增、空 `idle-0` 至 `idle-9`、1,500ms 初始化等待與 18 秒窗口。沒有建立 PTY，也沒有使用者 session fixture 或偽造監控來源。

額外啟用 main Inspector profiler 並透傳原 fs／JSON／exec 呼叫，只記計數、位元組量與 profiler frame，不記 session 內容。診斷視窗統計：

| 真實呼叫 | 計數／量 |
| --- | ---: |
| Claude status readFile | 1,383 次 |
| readFile bytes | 249,759 bytes |
| Codex rollout open | 187 次 |
| open handle read | 363 次／6,379,648 bytes |
| JSON.parse | 2,228 次／4,842,868 characters |
| readdir／stat | 38／370 次 |
| execFile 開始／完成 | 4／4 次 |

Profiler 視窗 18,122.217ms，main 執行 frame 可見 `runOnce`、`WorkspaceManager.list`、`existsSync`／`statSync`、`defaultReadSessions` 與 rollout `readFirstLine`。讀檔與程序掃描在整個閒置視窗重複發生，不能把問題只歸因冷啟動；V8 CPU profile 不涵蓋所有原生／工作執行緒 CPU，不用 frame 時間冒充精確的總 CPU 成本分攤。

插入 profiler 的 CPU 26.127777777777776% 有診斷成本，不能當未插 instrumentation 的效能通過或失敗基準。該臨時診斷 spec 的 exit 0 只代表 profile 蒐集完成，不代表 10% budget 通過。原始檔：`idle-cpu-instrumented-profile.txt`、`idle-cpu-instrumented-profile.json`、`idle-cpu-instrumented-profile-summary.json`；腳本原文 `idle-cpu-profile-source.txt` 不含 session 內容。

## 根因與授權修正

`ClaudeStatusMonitor.runOnce` 原先先掃整機程序、讀三種全域 session，再以 `pidsOf` 把沒有 PTY 的工作區降為 idle。即使十個工作區都沒有終端機，仍為必定被丟棄的狀態支付讀檔與解析成本。遇到新 session，原本又逐筆 `workspaces.list()`，每次皆對工作區進行存在／stat 查詢。RemoteService 未啟用時沒有 listener／timer；本輪未改其程式。

在主代理明確授權後，僅改 `runOnce`：先取得一次工作區清單；全無納管 PTY 時逐工具更新 idle 後返回，不讀 session、不掃程序。有 PTY 時沿原流程掃描及讀取，保留 fail-open、首次掃描、force 補掃、new-session 合流與 3 秒週期，並復用本輪工作區清單。非同步查詢後仍重新呼叫最新 `pidsOf` 判斷存活，沒有沿用最初 PTY 狀態到回覆完成。

## 回歸、靜態驗證與指南核對

先在原產品加六個必要回歸並實跑：3 failed／12 passed、exit 1。失敗驗證空 PTY 仍掃描、最後 PTY 關閉後仍讀來源、單輪工作區清單被讀 32 次而非 1 次。原始輸出 `idle-cpu-monitor-regression-red.txt`。

修後完整監控單元領域 5 files／42 tests passed，exit 0，原始輸出 `idle-cpu-monitor-green.txt`。新增案例也驗證閒置後重新開 PTY 恢復監控、混合工作區隔離，以及已 running→第二次來源卡住→關閉 PTY→resolve→idle，遲到回覆不再發布 running。

`npm run typecheck` exit 0（`idle-cpu-typecheck.txt`），`git diff --check` exit 0。修正 source diff 已保存 `idle-cpu-source.diff`。建置與原效能 GUI 複驗完成後追加各自原始結果，未修改 perf source、budget、視窗、等待、skip 或 retries。

`npm run build` exit 0，renderer 1m21s，原始輸出 `idle-cpu-build.txt`。原 REQ-MON-006 修後單次實跑 exit 0，1 passed（33.5s），程序 34,863ms；perf report 閒置 CPU 0.8%（報告取一位小數）、10 個工作區、18,000ms、原 budget 10%。原始輸出 `idle-cpu-after-fix.txt/json` 與 `idle-cpu-after-fix/perf-report.json`。沒有改測試、插 profiler、提高門檻或改等待，也沒有失敗後篩選重跑。

本次只減少沒有 PTY 時的背景監控成本，未改入口、徽章四態語意、操作、風險確認與七步導覽。HelpCenter／GuidedTour 的既有 AI 狀態與終端機說明不受影響，不需要改內容或 selector；README／CHANGELOG／MAP 由主代理同步修正範圍。

## 限制與清理

此效能通過證明本機、10 個沒有 PTY 的工作區、原 18 秒閒置情境；沒有聲稱活躍 AI／有 PTY 時也低於 10%。有 PTY 的來源讀取與掃描成本刻意保留，現有 fail-open／force 行為由監控領域回歸驗證。scoped 結果不是 full green，正式全量仍須主代理重跑。

原案與修後案均由既有測試關閉 Electron 並清理 userData／各工作區資料夾；其 `seedWs` 留下的 20 個空 `pdperf-*` 父目錄，以兩次實跑時間區間、數量與空目錄檢查定位，確認絕對路徑仍在 TEMP 後逐一清理。帶 profile fixture 的完整 root 與 userData 由自己的 finally 清理。唯讀程序檢查本 worktree Electron main 剩餘 0 個。自有 TEMP diagnostic config／腳本／結果目錄清理，原始腳本已另留 QA 附件，不包含使用者 session 內容。
