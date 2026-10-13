# Portable 解壓清理修正

第一份正式 EXE 三次隔離啟動（兩次正常 window.close、一次 Windows CloseMainWindow）均通過版本、預設關閉、renderer 隔離、忽略測試 gateway、缺少 Tailscale 回饋、停止監聽與依賴封裝檢查。wrapper 都正常 exit 0，但自己的解壓目錄留下 Polydesk.exe，因此整體 smoke 失敗，未交付該版。

確認模板原本只做一次 RMDir，未檢查目錄仍存在。實際 EXE 當下由誰持有檔案尚未確認，不將防毒、CDP 或子程序列為確定根因。[StdUtils 官方實作](https://raw.githubusercontent.com/lordmulder/stdutils/1.14/Contrib/StdUtils/src/StdUtils.cpp) 的 WaitForProcEx 正常等待後會 CloseHandle；本修正沒有重複關閉 handle。

修正僅限本次獨立 $PLUGINSDIR/app：最多 50 次清理，間隔 100ms；耗盡明確 exit 1。R6 無法確認程序狀態時仍保留檔案。argv、靜態畫面交接、marker、等待程序與兩分鐘啟動期限均未變動。

真 Windows FileStream 不允許刪除的鎖搭配實際 makensis，取最新模板的清理尾段編譯執行。舊版 1800ms 鎖時 exit 0／removed false，重現假成功；修後短鎖 exit 0／removed true（2597ms），6500ms 鎖超過重試預算時 exit 1／removed false（6783ms），R6 保留時 exit 1／removed false（273ms）。三項斷言通過。typecheck exit 0；portableSplash、portableStartup 兩檔四項測試通過。

2026-10-12 正式 20 指令綠燈與簽章是在本次 launcher 修正之前，不能當作此修正的簽章。此變更不涉及 shared IPC、遠端權限、資料格式或 UI；縮圈驗證涵蓋模板、實際 NSIS 鎖與重新建置的 EXE。新版 EXE 的正常退出清理仍待實際重建驗證。

導覽與完整指南檢查：此修正只影響程序退出後的本次暫存檔清理，入口、步驟、selector、畫面、配對與安全說明皆不受影響，無須改動凍結 UI。

證據：同目錄三份 first/second/third-native cleanup-failure JSON、portable-cleanup-probe-red.json、green.json 及 run-portable-cleanup-probe.cjs。
