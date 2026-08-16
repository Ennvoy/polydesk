# 084 UI 降噪修正版核准並重新凍結

- 背景：依決議 083 修正頂部版面控制列、SCM recovery 卡與冗長 Git 錯誤呈現後，提供兩張真 Electron 截圖供使用者檢視。
- 決定：核准本次低彩度工具列、縱向 recovery 卡及預設折疊技術細節的畫面，重新凍結 `scm.css`、`DockLayout.tsx` 與 `DockLayout.css`，繼續出貨流程。
- 原因：修正版已消除窄側欄逐字斷行、按鈕受壓與高彩度控制列搶焦問題，同時保留診斷資訊與既有操作行為。
- 證據：使用者在檢視 `ui-layout-toolbar-refined.png` 與 `ui-cleanup-recovery-responsive.png` 後原話「好，繼續吧」；真 Electron 合併驗證 2/2 通過。
