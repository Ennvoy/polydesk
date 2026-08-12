## 2026-08-12 portable 單一動畫啟動畫面
- 修正自解壓靜態 BMP 無法轉動、關閉後又跳出 Electron splash 的雙重啟動畫面。
- 移除 `portable.splashImage` 與 BMP 資產；自解壓完成後只保留既有 Electron 動畫 splash，接受自解壓期間短暫無畫面的取捨。
- 主視窗 ready 握手、安全設定、失敗重試／退出與首次導覽／完整使用指南均不受影響。
- 關鍵決策為 `decisions/041`；版本升至 v0.29.0。完整 ship runner 20/20 指令通過：Vitest 572/572、112 個非豁免 Electron E2E 全綠、3 個真 AI dogfood 跳過；功能提交待完成後回填。

## 2026-08-11 portable 自解壓啟動畫面
- 完成 1 張票：portable 自解壓期間先顯示 420×230 原生 splash，Electron 能建立視窗時以同尺寸畫面盡快接手。
- 移除 250 ms 顯示門檻；主初始化等原生 `show` 事件，`ready-to-show` 與 renderer-ready 交接、安全與失敗處理不變。
- 關鍵決策為 `decisions/039`–`040`；如實揭露 Windows 驗簽／防毒與兩程序交界不保證零延遲。
- 功能提交 `b8eb542`；完整 ship runner：Vitest 572/572、112 個非豁免 Electron E2E 全綠、3 個真 AI dogfood 跳過；Spec／Standards 複核皆 0 blocker、0 suggestion。

## 2026-08-10 工作區標頭、首次導覽與啟動畫面
- 完成 3 張票：移除最左側活動列並把四個入口放進工作區標頭；新增首次 7 步導覽、可搜尋完整指南與冷啟動 splash。
- 導覽狀態以 schema v3 安全持久化，手動重開不覆寫首次狀態；功能文件涵蓋總覽用量與 AI commit 草稿等既有入口。
- splash 等待工作區載入、`ready-to-show` 與固定白名單 renderer-ready 握手後才交接主窗；失敗可重試／退出，第二實例不會提前顯示。
- 功能提交 `ad93a35`；完整 ship runner：Vitest 571/571、112 個非豁免 Electron E2E 全綠，3 個真 AI dogfood 跳過；Spec／Standards 複核皆 0 blocker。冷啟動 p95 3,896 ms 依既有核准豁免揭露，門檻未放寬。

## 2026-08-10 完整移除終端機導覽軸
- 依使用者澄清，移除的是整個終端機內容／對話導覽功能，不再保留通用 xterm 導覽作為 Claude／Codex 專用軸的替代。
- 刪除 renderer DOM／CSS、buffer 掃描、節點與鍵盤跳轉、純函式單測及真 PowerShell 導覽 E2E；所有終端收回左側預留空間。
- Claude bypass、Codex、Agy 快捷啟動真 Electron 回歸綠，整頁導覽元素為 0；PTY、scrollback、尺寸同步與 AI 狀態不變。
- typecheck、build、完整 Vitest 562/562 與 105 個非 dogfood Electron E2E 綠；3 個真 AI dogfood 依條件跳過，檔案連結初跑一次時序 flake 於單案與完整 shard 重跑皆綠。

## 2026-08-10 標頭關閉維持側欄尺寸
- 編輯器／終端機標頭 `×` 改為原地隱藏，不再移除 panel 並觸發版面樹重排。
- 隱藏或叫回編輯器／終端機時，側欄維持操作前的實際寬度與高度；component 與工作狀態留在原實例。
- 新增純函式尺寸契約與真 Electron 標頭關閉回歸，修正前實測側欄寬度漂移 49 px。
- typecheck、build、完整 Vitest 565/565 與 106 個非 dogfood Electron E2E 綠；3 個真 AI dogfood 依條件跳過，冷啟動既有門檻沿用核准豁免。

## 2026-08-08 移除 Claude／Codex 專用對話軸
- 依 dogfood 回饋移除專用對話軸，兩種 AI 終端機回到一致的通用內容導覽。
- 刪除 shared IPC、main readers／session 配對、renderer 輪詢與專用樣式；終端機不再為導覽讀取 transcript／rollout。
- 保留快捷啟動、PTY 尺寸同步、Claude hook 狀態清理與工作區 AI 徽章。
- typecheck、build、目標回歸、完整序列 Vitest 564/564 與 106 個非 dogfood Electron E2E 綠；3 個真 AI dogfood 依條件跳過。

## 2026-08-06 Claude／Codex 使用者提問對話軸
- 完成 1 張票：Claude／Codex 對話軸只保留使用者提問，快捷與手動啟動行為一致。
- 影響 terminal renderer、shared IPC、PTY／process／session 綁定、Claude transcript 與 Codex rollout reader。
- 關鍵決策：`decisions/006`–`009`、`011`；無可靠 terminal/session 證據時一律 fail-closed。
- 全量 591 Vitest、109 非豁免 E2E 綠；3 個真 AI dogfood 跳過，冷啟動既有門檻依核准豁免。

## 2026-08-06 SCM 分支分組與安全刪除
- 完成 1 張票：本地／遠端分組、共用操作選單與安全刪除完整鏈路。
- 影響 SCM renderer、shared IPC／型別、GitService、錯誤分類與真 Git／Electron 測試。
- 關鍵決策：`decisions/001`–`005`、`009`–`010`；對話軸功能延後獨立發布。
- 全量 574 Vitest、110 非豁免 E2E 綠；冷啟動既有門檻依使用者核准豁免。
