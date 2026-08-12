# 041 portable 只保留單一 Electron 動畫 splash

## 背景

electron-builder 的 `portable.splashImage` 只能顯示靜態 BMP。portable 自解壓器會在啟動 Electron 前銷毀自己的 splash，因此現況先顯示無法轉動的靜態畫面，關閉後再建立具有 CSS 動畫的 Electron splash，形成兩次啟動畫面與明顯跳動。

## 決定

移除 portable 自解壓器的靜態 splash，只保留自解壓完成後由 Electron 建立的 420×230 動畫 splash。維持單一 portable EXE，接受自解壓期間短暫沒有畫面的取捨，不導入自製 Windows launcher。

本決議取代 `decisions/040-portable-extraction-splash.md` 的雙層 splash 決定；040 對 electron-builder／NSIS 技術邊界的記錄仍然有效。

## 原因

現有封裝器無法讓 BMP 動起來，也無法把自解壓器視窗交給 Electron 延續使用。移除第一層是維持單一 EXE、消除兩次 splash，且不新增原生 launcher 維護與安全面的最小可靠方案。

## 證據

使用者回報雙擊後第一個啟動畫面不會轉動，接著關閉並跳出第二個會轉動的啟動畫面；在「保留單一 portable EXE，只顯示一個 Electron 動畫 splash」等方案中選擇選項 1。
