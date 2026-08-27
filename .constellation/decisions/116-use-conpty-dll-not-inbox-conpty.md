# 116 Windows PTY 一律改用 node-pty 內附 conpty.dll，不再用 OS 內建 ConPTY

- 背景：使用者回報 Claude 分頁捲不動、輸入中文吃字，v0.32.0 的滾輪接管（decision 099）修了 xterm 端仍未根治。2026-08-21 診斷（`問題診斷-終端機捲動與吃字.md`）指出病根是內建 ConPTY 的缺陷。2026-08-25 於 Win11 26200（conhost 10.0.26100.1）以 node-pty 直測複驗四輪，結果修正原診斷的一項描述：`?1049h`（alt screen）**在內建 ConPTY 下是穿透的**，被吞的是 `?1003h`／`?1006h`（滑鼠追蹤）；連同不穿透 SGR 滑鼠回報、自行重繪時寬字（中文）處理錯誤，構成本次修法的依據。
- 決定：`PtyManager` spawn 一律加 `useConptyDll: USE_CONPTY_DLL`（Windows 預設開；`POLYDESK_CONPTY_DLL=0` 為排查逃生口），改用 node-pty 內附的新版 OpenConsole conpty.dll，VS Code `terminal.integrated.windowsUseConptyDll` 同一機制。接受兩個已知代價：程序結束回報慢約 2 秒（出口稽核確認無任何 timeout 依賴 exit 事件，僅可感知延遲）；node-pty dll 分支 kill() 不再撲殺 console process list（常規樹仍由 Polydesk 自己的 `taskkill /T /F` 全覆蓋）。
- 原因：三個缺陷同一病根，一個修正同時解決捲不動與吃字；renderer 端 xterm 程式碼本來就沒錯，繼續在 xterm 端繞只會像 v0.32.0 一樣修不到。真 PTY 鏈路 e2e（`terminal-conpty-passthrough.spec.ts`）內建 ConPTY 必敗、conpty.dll 通過，證明測試抓得到病根。
- 證據：使用者讀完診斷文件摘要後指示「你接著繼續修好」（2026-08-25），即拍板採用該修法落地。實測數據見診斷文件（滾輪序列穿透 hex dump、alt-screen 模式對比、寬字覆寫行為對比、`cmd /c exit 3` 結束回報 1.1s→3.2s）。
