# 118 portable 自解壓先顯示靜態開啟畫面

## 背景

目前 portable EXE 自解壓期間沒有視窗，Electron 啟動後才顯示動畫開啟畫面。使用者雙擊後需等待較久才看到任何回饋。

## 決定

恢復 electron-builder `portable.splashImage`，自解壓期間顯示既有的 420×230、24-bit RGB Polydesk BMP。Electron 啟動後以同尺寸、無動畫的本機開啟畫面接手；兩層均不設定最低停留時間，主畫面可操作後立即關閉。失敗時仍在 Electron 畫面顯示原因、重試與退出。

本決議依本次使用者需求取代 041「只保留單一 Electron 動畫 splash」的取捨，恢復 040 的封裝方式與技術邊界。

## 原因與邊界

Electron 程式碼只能在 portable 解壓完成後執行，無法覆蓋前段空白。封裝器可在解壓時顯示 BMP；靜態的 Electron 畫面能延續同樣的視覺狀態。封裝器在啟動 Electron 前會關閉自己的視窗，兩個程序交接仍可能有短暫空檔。Windows 執行前的安全檢查與排程也無法由應用程式保證立即顯示。

## 證據

使用者本次要求：「一點下去就先有一個開啟畫面然後再開始啟動程式？不用動畫也沒關係但至少讓使用者知道程式已經在啟動」。electron-builder 官方 `PortableOptions.splashImage` 說明 BMP 在 portable executable 解壓時顯示：<https://www.electron.build/docs/api/electron-builder.interface.portableoptions/>。官方圖像規格要求 NSIS BMP 使用 24-bit RGB：<https://www.electron.build/v26/docs/features/icons-and-images/>。
