# T-010 私人配對與固定 Claude 啟動
status: done
blocked-by:
zone: src/main/remote/**, src/main/index.ts, src/main/pty/**, src/main/ipc/**, src/preload/**, src/shared/**, tests/**, e2e/remote-launch.spec.ts
exclusive:

## 目標（行為契約，禁寫實作內部路徑/程式碼片段——durability over precision）

建立僅供私人 Tailscale 網路使用的遠端啟動核心，安全配對手機瀏覽器與各自的 Polydesk，僅允許在電腦端明確授權的工作區執行固定 Claude bypass 啟動。配對期限、工作區實際路徑驗證、撤銷、固定 IPC 契約、操作持久性與未知結果處理須共同維持 fail-closed；功能預設關閉，不得接受任意命令或暴露公開服務。

## 驗收條件（合成階段寫定，逐條可勾）

- [x] 私人 gateway 只在 loopback 接收本機請求，透過 Tailscale Serve 提供私網 HTTPS；不得開 LAN／公開 listener、啟用 Funnel，或在 Tailscale 不可用時降級到其他網路。
- [x] HTTP 請求驗證 Host、Origin、CSRF、內容型別、JSON 結構與容量；不信任代理身分標頭取代配對認證。憑證不出現在 URL，配對挑戰僅置於瀏覽器立即移除的 URL fragment，不出現在 query、伺服器日誌或外部 QR 服務。
- [x] 配對使用 2 分鐘有效的一次性 QR／手動碼挑戰；每個挑戰只綁定一個手機瀏覽器秘密，兩端確認同一配對識別碼。拒絕或到期後須重新申請。
- [x] 電腦端批准時可為該瀏覽器選擇 7 天（預設）、30 天或永久；期限自批准時間起算，永久直到手動撤銷；調整期限須先撤銷再重新配對。過期、撤銷、功能關閉或未配對均拒絕啟動。
- [x] 工作區授權綁定 `wsId` 與驗證後的實際路徑；新增工作區不自動授權。建立 PTY 前及送出啟動命令前都重驗授權、工作區存在及路徑身分；路徑遺失或不符時 fail closed。
- [x] 撤銷後阻止尚未送出的命令，不終止已啟動的 Claude；IPC 只暴露固定白名單操作與固定 Claude bypass 能力，不接受 shell、任意命令或任意 cwd。
- [x] 操作以 `opId` 綁定配對裝置與工作區，持久保留 7 天、最多 1000 筆；同一操作具冪等性並限制速率及併發。容量已滿拒絕新請求，不覆蓋保留中的紀錄。
- [x] 重啟時尚未完成的操作標記「結果未知」，不得恢復執行。未知或查無紀錄不得自動重送；相同 `opId` 查詢只能讀取原操作結果。電腦或 Polydesk 離線時立即回報且不排隊。
- [x] 遠端啟動預設關閉；只有明確啟用且配對、工作區授權、Tailscale 私網狀態均有效時才接受請求。零個授權工作區時不傳回或顯示未授權工作區名稱。
- [x] 回報成功只表示真實 Claude 分頁已建立且固定命令已送出，不宣稱 CLI 已安裝、登入成功或工作階段已就緒。

## 決議記錄（實作期小事自決落此，可追溯）

- 決議 121–133 與 `engineering-defaults.md` 定義本票行為契約；其中推薦工程預設依決議 133 授權採用，不表示使用者逐項確認。
- 保留 `.constellation/config.json` 的 `approved: true` 原值。決議 133 已授權依推薦完成至出貨，不再就同一範圍重複詢問核准。
- 修正票面「一次性碼不在 URL」的過廣轉譯：既定 QR 使用 fragment，不發送給 HTTP server，規格禁止的是 query／日誌／外部 QR；並補 main 啟停生命週期為預期範圍。

## 驗證指令

在實作完成後執行下列領域驗證；已完成，原始結果與 runner 簽章見下方證據。

- `cmd /c npm run typecheck -- --pretty false`
- `cmd /c npm test -- src/main/remote src/main/pty src/shared --maxWorkers=1 --minWorkers=1`

## 驗證證據（關票時由 runner 寫入：指令＋結果摘要＋時間）
- **2026-10-12T10:09:00.913Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    > polydesk@0.40.0 typecheck
    > tsc --noEmit --pretty false
    ```
  - `cmd /c npm test -- src/main/remote src/main/pty src/shared --maxWorkers=1 --minWorkers=1`（exit 0）
    ```
     ✓ src/shared/releaseNotes.test.ts (3 tests) 19ms
     ✓ src/shared/gitClone.test.ts (5 tests) 9ms
     ✓ src/shared/gitPublish.test.ts (7 tests) 9ms
     ✓ src/shared/externalUrl.test.ts (2 tests) 7ms
     Test Files  7 passed (7)
          Tests  67 passed (67)
       Start at  18:08:23
       Duration  35.41s (transform 980ms, setup 0ms, collect 2.48s, tests 21.86s, environment 3ms, prepare 3.68s)
    ```
  - 耗時：合計 75s｜cmd /c npm run typecheck -- --pretty false 31s｜cmd /c npm test -- src/main/remote src/main/pty src/shared --maxWorkers=1 --minWorkers=1 44s
  - sig: 48f2cbdd6150a86deacb1a1c21308c4f30f5d940948f54ff2606241870dcac9f
- **2026-10-12T10:14:15.941Z**
  - `cmd /c npm run typecheck -- --pretty false`（exit 0）
    ```
    > polydesk@0.40.0 typecheck
    > tsc --noEmit --pretty false
    ```
  - `cmd /c npm test -- src/main/remote src/main/pty src/shared --maxWorkers=1 --minWorkers=1`（exit 0）
    ```
     ✓ src/shared/releaseNotes.test.ts (3 tests) 15ms
     ✓ src/shared/gitClone.test.ts (5 tests) 8ms
     ✓ src/shared/gitPublish.test.ts (7 tests) 9ms
     ✓ src/shared/externalUrl.test.ts (2 tests) 7ms
     Test Files  7 passed (7)
          Tests  69 passed (69)
       Start at  18:13:45
       Duration  29.56s (transform 592ms, setup 0ms, collect 1.70s, tests 21.08s, environment 2ms, prepare 2.19s)
    ```
  - 耗時：合計 54s｜cmd /c npm run typecheck -- --pretty false 17s｜cmd /c npm test -- src/main/remote src/main/pty src/shared --maxWorkers=1 --minWorkers=1 37s
  - sig: 8f73bea56a4eee870af578cfa0952983f809e0303b6138e5a45509beb1f7282d
