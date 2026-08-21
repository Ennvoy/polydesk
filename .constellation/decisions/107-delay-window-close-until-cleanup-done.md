# 107 關閉 Polydesk 時延後視窗關閉並顯示清理進度，取代決議 104

- 背景：決議 104 要求退出清理期間於畫面顯示進度。獨立審查指出該時序不成立，讀碼確認——`mainWindow.on('close')` 在使用者核可後放行 → 視窗銷毀 → `closed` 事件將 `mainWindow` 設為 null → `window-all-closed` → `app.quit()` → `before-quit` → `shutdownAndExit()`。清理開始時視窗早已銷毀，`shutdownAndExit` 內 `const wc = mainWindow && !mainWindow.isDestroyed() ? ... : null` 正是為此而寫。104 的背景敘述（視窗靜止十秒）亦與事實不符。
- 決定：**把清理移到視窗關閉之前**——使用者於關閉確認核可後，視窗保持開啟並顯示「正在清理背景程式…」，清理完成（或逾時）後才真正關閉視窗並退出。
- 原因：真正的失敗模式是視窗立即消失、程序仍在背景執行最長 10 秒，期間 (a) 使用者於工作管理員看到 Polydesk 仍在而強制結束，正好造成唯一完全清不掉的結局；(b) 立即重新開啟 Polydesk 會因 `index.ts:233` `requestSingleInstanceLock()` 失敗而靜默 `app.quit()`，使用者只看到「點了沒反應」。決議 096 將逾時由 3 秒放寬至 10 秒使此窗口延長三倍，此代價先前未揭露。改為延後關閉後，視窗消失即代表確實退出完畢，重新開啟必定成功，且進度可見不會被誤認為當機——此為一般應用程式「儲存中請稍候」的標準行為。
- 證據：使用者於彈窗選擇「讓視窗晚一點關（推薦）」。當時依據為 `src/main/index.ts:207-228`（close 攔截與 closed 清空 mainWindow）、`:282-296`（window-all-closed → before-quit）、`:302-312`（shutdownAndExit 對 mainWindow 已為 null 的防禦）之讀碼確認。
- 取代：本決議取代 104 的實作位置；104 的目的（讓使用者知道程式仍在運作、避免強制結束）不變。
