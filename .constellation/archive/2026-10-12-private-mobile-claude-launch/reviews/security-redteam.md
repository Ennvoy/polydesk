# 遠端啟動獨立安全回歸檢查

日期：2026-10-12。範圍：`C:/polydesk-remote-dev` 隔離檔案 fixture、隨機 loopback HTTP listener、注入 gateway／PTY dependencies。未操作外部系統、真實 Tailscale 帳號或使用者資料；未修改產品；未執行全量 runner、commit、push 或 dist。未閱讀其他審查結論。

## 結論

既有指定測試 12/12 PASS；獨立補充檢查 5 PASS、2 FAIL。尚有兩项須處理的具體缺口。以下「確認」僅指本機重現的程式行為，不代表已完成手機／真 Tailscale 或真實 OS PTY 的外部整鏈驗證。

## 已確認問題

### SEC-01：重新授權新路徑後，舊路徑的 pending 終端仍收到 bypass 命令

- 嚴重度：中。成立前提是啟動已建立終端但尚未收到 renderer ready，此間同一工作區 ID 改指向另一個實際路徑，桌面再授權該新路徑。
- 重現：授權 `w → A`；以實際 HTTP `POST /api/launch` 建立 `t1`；將 fixture 的 `w.path` 改為已存在的 `B`；呼叫公開桌面服務 `allowWorkspace('w', true)`；再呼叫 `rendererReady(opId, 't1')`。
- 實際結果：注入的 PTY write callback 被呼叫 1 次；預期 0 次，回歸 assertion 為 `expected 1 to be +0`。沒有執行真正的 Claude CLI。
- 具體後果：新路徑的授权被用來放行舊終端。實際 PTY 在建立時以原工作區路徑為 cwd（`src/main/pty/PtyManager.ts:464`），因此產品整合下預期會向原位置的終端送命令，與「授權綁定實際路徑」契約不符。cwd 後果由產品實作推導；已實測的是 RemoteService 在此狀態仍呼叫 write。
- 原因：`src/main/remote/RemoteService.ts:20` 的 Operation 不保存建立時路徑，`:251` 也只保存 wsId；`:93` 的新授權直接覆寫 grant；`:266` 僅驗證「當下工作區與當下 grant」一致，`:271` 隨後寫入原 termId。
- 修復驗收：pending 操作應綁定建立時的 path identity；重新授權不能讓舊操作借用新路徑的授權。上述 fixture 應變成 write=0，且原待送終端被關閉或標記失敗。

### SEC-02：Foreground 內啟用 Funnel 不會使設定驗證失敗

- 嚴重度：中；此項是設定 fail-closed 缺口，未證明 HTTP 認證或 Funnel header 防線被繞過。
- 重現：mock CLI 回傳既有、正確的 top-level 私人 Serve 8443；再加入 `Foreground['fixture-session']`，其中 TCP/Web 設定 443 代理同一 loopback、`AllowFunnel['desktop.team.ts.net:443'] = true`；呼叫 `TailscaleGateway.verify(url)`。
- 實際結果：Promise 成功返回 `undefined`；預期應拒絕 Funnel，assertion 為 `promise resolved "undefined" instead of rejecting`。
- 具體後果：此型態的設定漂移不會觸發 RemoteService 的定期閘道失敗停用流程，介面仍可保持啟用。現行 `src/main/remote/TailscaleGateway.ts:26` 只取 top-level `AllowFunnel`，未檢查 Foreground。`RemoteService.checkGateway()` 依賴 verify reject 才停用。
- 防線仍有效的證據：既有實際 HTTP 測試帶 `Tailscale-Funnel-Request: ?1` 得到 403。不能把本項描述成公開網路可直接啟動 Claude。
- 修復驗收：任一 Foreground 配置的公開入口必須造成 verify 拒絕，並在服務整合測試確認 listener 關閉；必要時對不認識的前景配置採拒絕。

## 實測紀錄

執行 `cmd /c npx vitest run src/main/remote/RemoteService.test.ts src/main/remote/TailscaleGateway.test.ts`：2 files、12 tests PASS（17:50:03 開始，6.28 秒）。涵蓋未授權、Host／Origin／CSRF、Funnel header、一次性碼、固定命令、撤銷、到期、gateway fail-closed、限流、併發、重啟冪等。

獨立 HTTP fixture 執行：6 tests，5 PASS、1 FAIL（17:51:21 開始，3.24 秒）。

| 檢查 | 結果 |
|---|---|
| 格式合法但未授權 cookie；錯誤 Origin 不建立終端 | PASS |
| 同一挑戰併發配對只批准一份候選；到期候選不能批准；cookie flags | PASS |
| await gateway verify 期間撤銷，送命令前重新檢查 | PASS，建立 1、寫入 0、關閉 1 |
| 工作區移除／改為其他存在路徑，送命令前拒絕 | PASS，寫入 0 |
| 同 op 併發與重啟後重送不增加終端 | PASS，建立維持 1，重啟結果 unknown |
| 工作區改路徑並重新授權，原 pending 終端不得送出 | FAIL，SEC-01 |

獨立 gateway CLI mock fixture 執行：1 test FAIL（17:52:18 開始，3.61 秒），SEC-02。此測試不呼叫真正 Tailscale CLI。

## 可重現附件與命令

附件保存在本目錄：`RemoteService.security-repro.ts`、`TailscaleGateway.security-repro.ts`。它們原本位於 `src/main/remote/`，測完已移出 Vitest include 範圍，避免污染全量測試。重現時從 repository root 執行：

```powershell
Copy-Item .constellation/reviews/RemoteService.security-repro.ts src/main/remote/RemoteService.security-scratch.test.ts
Copy-Item .constellation/reviews/TailscaleGateway.security-repro.ts src/main/remote/TailscaleGateway.security-scratch.test.ts
cmd /c npx vitest run src/main/remote/RemoteService.security-scratch.test.ts src/main/remote/TailscaleGateway.security-scratch.test.ts
Remove-Item -LiteralPath src/main/remote/RemoteService.security-scratch.test.ts,src/main/remote/TailscaleGateway.security-scratch.test.ts
```

附檔只建立 `.security-fixture-*` 專屬暫存資料夾，afterEach 會關閉本測試 listener 並清理對應 fixture。以上行號對應首次檢查版本；同時有 implementation agent 進行修正，修復結案仍需重新執行並記錄。

## 本輪界限

`remoteHandlers.ts:14` 可見 test gateway 受 `!app.isPackaged` 限制；本輪未以 packaged binary 實測，不能宣稱打包測試 seam 已驗證。手機到私有 Tailscale HTTPS 的真實外部鏈路、真 Electron／PTY 與 Windows 鎖定狀態也不在本輪實測範圍。

## 修復後複驗（2026-10-12 17:59）

依本次限定範圍，將兩份原始附件原樣複製回暫時測試檔，與 `src/main/remote` 兩份既有單元測試一起執行；沒有擴大檢查或修改產品。

```powershell
Copy-Item -LiteralPath .constellation/reviews/RemoteService.security-repro.ts -Destination src/main/remote/RemoteService.security-scratch.test.ts
Copy-Item -LiteralPath .constellation/reviews/TailscaleGateway.security-repro.ts -Destination src/main/remote/TailscaleGateway.security-scratch.test.ts
cmd /c npx vitest run src/main/remote/RemoteService.test.ts src/main/remote/TailscaleGateway.test.ts src/main/remote/RemoteService.security-scratch.test.ts src/main/remote/TailscaleGateway.security-scratch.test.ts
```

實際結果：exit code 0；4 test files PASS、25 tests PASS；17:59:22 開始，5.44 秒。

| 原案例／測試集合 | 複驗結果 |
|---|---|
| SEC-01：工作區換路徑並重新授權後，原 pending 終端不得送出 | **PASS / resolved**；原附件 `writes === 0` assertion 通過；既有產品回歸另確認 closed=1、result=failed |
| SEC-02：Foreground 啟用 Funnel 應使 verify 拒絕 | **PASS / resolved**；原附件期待 reject 且訊息包含 Funnel，已通過 |
| RemoteService.security-repro 原附件 | 6/6 PASS |
| TailscaleGateway.security-repro 原附件 | 1/1 PASS |
| RemoteService.test.ts | 11/11 PASS |
| TailscaleGateway.test.ts | 7/7 PASS |

既有 gateway 單元測試亦通過：Funnel drift 下移除自己的 matching endpoint；第一次 off 失敗後仍可重試且共送出兩次 off；不移除別人的 replacement handler。既有 RemoteService 測試中的 in-flight enable 取消與 shutdown 期間禁止再次 enable 也通過。以上屬指定既有測試的結果，本次未另加新案例。

兩項首輪失敗在本地 fixture 範圍均已 resolved，原失敗案例無 unresolved。兩份暫時 `*.security-scratch.test.ts` 執行後移除；原附件留存於 reviews 供重跑，自有 fixture 與測試 listener 已由 afterEach 清理。未執行 build、全量 runner、commit 或 push。首輪記錄保留作為修復前證據；外部實機驗證界限維持不變。

## 最新版本紀錄核對（2026-10-12，Queue capacity fix 後）

本次只讀取指定既有驗證紀錄與產品／測試原始碼，沒有新增或執行測試、沒有外部請求。`package.json` 目前版本為 `0.40.0`。

讀取 `.constellation/qa/remote-launch/target-validation.txt` 最後一段 `Queue capacity fix validation 2026-10-12T10:13:16.595Z`，其紀錄為：

| 既有紀錄指令 | 紀錄結果（非本審查者本次實跑） |
|---|---|
| `npm run typecheck` | exit=0 |
| `npm test -- src/main/remote/RemoteService.test.ts src/main/remote/TailscaleGateway.test.ts` | RemoteService 14、TailscaleGateway 7，共 21/21 PASS；18:13:39 開始，5.33 秒；exit=0 |
| `npm run build` | exit=0 |
| `npm run e2e -- e2e/remote-launch.spec.ts` | 真 Electron 本機手機 HTTP 情境 1/1 PASS，23.1 秒；exit=0；不等同真手機／真 Tailscale 外網驗證 |

來源核對：SEC-01 修法仍在 `RemoteService.ts:296` 保存操作建立時 `path`，`:312` 在寫入前比較目前實際路徑；對應 path regrant 回歸仍存在並要求 writes=0、closed=1、failed。SEC-02 修法仍在 `TailscaleGateway.ts:23` 遞迴收集 Foreground 設定，`:49` 起逐一檢查 AllowFunnel；Foreground 回歸仍存在。未見兩項原修法退回。

最新兩個回歸也已讀碼核對：`RemoteService.test.ts:161` 在 gateway verification 未完成時，另一新 operation 應即時 429，不能形成待執行佇列；`:176` 在停用再啟用後釋放舊 verification，要求 spawned=0。產品 `RemoteService.ts:269` 的 in-flight gate 與 `:287` 起的 lifecycle generation 重驗分別對應這兩個條件。

證據界限：本審查者親自實跑的最近一次仍是上一節 17:59 的 25/25（當時既有 18 項加附件 7 項）。本次最新 21/21、typecheck、build、Electron E2E 均是讀取既有執行紀錄，不宣稱已自行重跑新版 21 項或原附件。SEC-01／SEC-02 維持「前次實測已 resolved，本次源碼與既有新紀錄確認修法仍在」；未閱讀其他審查軸報告或全量 runner。
