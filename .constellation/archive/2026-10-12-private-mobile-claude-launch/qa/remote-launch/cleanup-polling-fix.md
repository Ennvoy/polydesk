# SCM 清理進度查詢累積修正

## 實際根因與原始證據

原版 `withCleanupProgress` 每 250ms 發送一次 `cleanupStatus`，不等待上一筆完成。主程序逐筆執行 `cleanup:claims`，每次狀態讀取仍須真實 Git common-dir 查詢；單次耗時超過輪詢間隔時，已接受請求持續累積。清理成功後停止 interval 並不能清掉既有佇列，最後一次狀態讀取須等待它們，`run` 也因此尚未解除 busy。

真實 Electron／IPC／Git 隔離診斷使用本機 bare 遠端，沒有偽造回應或人工延遲：205 次狀態請求、觀測最大未完成 138 筆、execute 回覆時仍有 139 筆尚未回覆；最晚狀態回覆在 execute 後 68,384ms。遠端 ref 確實刪除後，再過 73,925ms 刷新按鈕才可操作。208 次 common-dir Git 查詢耗時 220–2,082ms。此較小 fixture 最終通過，但已重現無界累積與完成後等待，並非同一次 120 秒逾時。

原始檔：`cleanup-busy-isolated-diagnostic.txt`、`cleanup-busy-isolated-diagnostic.json`。原 branch scoped 9.7 分鐘失敗仍保留於 `branch-scoped-after-adjustment.txt/json`，它在 remote ref 刪除後等待 busy 解除 120 秒失敗；增加 overall timeout 並未解決產品問題。

## 最小修正

- 改為上一筆查詢完成後，再等待 250ms 發下一筆；每個進度輪詢最多一筆未完成請求。
- 操作完成／失敗後停止排程，遲到回覆不能覆寫完成或失敗結果。工作區切換、卸載與新操作世代也停止舊進度。
- 查詢拒絕後可於下一輪重新讀取；保留操作本身及最後一次 `loadCleanupStatus` 的錯誤回饋。
- 保留 main cleanup coordinator、claims serial queue、安全判定、Git 操作與最後一次狀態讀取／busy 次序，沒有改變任何逐步 timeout。
- v0.40.0 關於視窗同步列出 SCM 修正；仍維持六條摘要。

## 回歸與靜態驗證

先以原版 setInterval 行為執行新回歸，得到 3 failed / 4 passed（exit 1），原始輸出保留於 `cleanup-progress-polling-red.txt`。慢查詢 10 秒累積 40 筆、失效工作區仍發出 4 筆、舊世代仍發布 5 次，三項均與預期失敗一致。

修後實跑 `npm test -- src/renderer/components/SourceControl/cleanupProgressPolling.test.ts src/renderer/components/SourceControl/cleanupFeedback.test.ts src/shared/releaseNotes.test.ts`：3 files / 13 tests passed，exit 0；其中新輪詢回歸 7 項、既有回饋 3 項、釋出紀錄 3 項。Vitest start 20:33:42、duration 3.36s。

`npm run typecheck` 實跑 exit 0；`git diff --check` 實跑 exit 0。建置及原 branch／web-link scoped GUI 結果完成後另附原始輸出，不把 scoped 或 partial 結果稱為 full green。

`npm run build` 實跑 exit 0，renderer build 1m52s，原始輸出 `cleanup-polling-build.txt`。既有 chokidar 未使用匯入警告不影響建置結果。

## 修後真實 GUI scoped 驗證

原 `git-branch-management.spec.ts` 首案例完整通過，exit 0，1 passed（6.2m），總程序時間 372,770ms。setup 29,635ms、profile/upstream 89,808ms、merged 68,293ms、remote 99,996ms、unfinished 79,322ms。remote 階段包含真遠端 ref 刪除、刷新按鈕恢復可用、實際刷新與清單更新；unfinished 階段包含強制清理確認、按鈕恢復、metadata 與 reflog 清除斷言。未提高任何逐步 timeout。原始輸出／結果：`branch-scoped-after-polling-fix.txt`、`branch-scoped-after-polling-fix.json`。

既定終端機連結測試獨立 repeat-each=3／workers=1 通過，exit 0，3 passed（31.5s），三次個案分別 12.6s、8.1s、7.5s，程序總時間 32,961ms。原 HTTP/file 白名單、Ctrl+click 只外開一次、一般 click 不新增外開、5 秒 hover 上限保持不變。原始輸出／結果：`web-link-scoped-after-adjustment.txt`、`web-link-scoped-after-adjustment.json`。

兩組測試均以既有 finally 關閉 Electron，清理各自 userData 與真 Git／檔案 fixture。結束後唯讀程序檢查：本 worktree 的 Electron main 剩餘 0 個，該次 branch fixture 已不存在。此處是 scoped 證據，不是正式 full green；正式全量與出貨仍由主代理執行。

## 教學與完整指南核對

已核對 `HelpCenter.tsx` 分支管理指南（109–116 行）與 `GuidedTour.tsx`：入口、兩階段確認、遠端 opt-in、安全選項、結果卡狀態與七步導覽均不變。本次調整進度查詢排程，現有「進行中顯示目前步驟／成功列出實際動作／失敗提供繼續收斂」仍正確，不需改指南內容或 selector。關於版本摘要已同步此次使用者可感知修正。
