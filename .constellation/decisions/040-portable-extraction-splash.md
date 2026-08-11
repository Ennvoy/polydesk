# 040 portable 自解壓階段顯示原生 splash

## 背景

Electron 主程序只能在 portable EXE 完成自解壓並啟動 Electron 後建立 BrowserWindow，因此單改應用程式內 splash 仍無法覆蓋使用者雙擊 EXE 到 Electron ready 之間的空白期。

## 決定

Windows portable 封裝使用 electron-builder 的 `portable.splashImage`，在自解壓期間顯示 420×230、24-bit RGB 的 Polydesk BMP；Electron 啟動後以同尺寸、同內容的既有 splash 接手，兩層都不設定最低停留時間。

## 原因

只有 portable 啟動器能在 Electron 程式碼執行前提供可見回饋；沿用同一畫面能減少兩個程序交接時的視覺跳動，且不必引入另一支自製 launcher。

## 證據

使用者澄清：「我想要的是一啟動就看到畫面，再慢慢讀取」；electron-builder 官方 `PortableOptions.splashImage` 說明該圖片會在 portable executable 解壓時顯示，且必須是 BMP：`https://www.electron.build/docs/api/app-builder-lib.interface.portableoptions/`。官方圖像規格另要求 NSIS BMP 使用 24-bit RGB：`https://www.electron.build/docs/features/icons-and-images/`。
