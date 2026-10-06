# 119 靜態開啟畫面移除圓圈

## 背景

決議 118 恢復了 portable 自解壓期間的靜態 BMP，並讓 Electron 接續顯示無動畫畫面，但兩層畫面都保留了原本轉圈所用的圓圈。圓圈不再轉動時，使用者會以為程式卡住。

## 決定

自解壓 BMP 移除圓圈，維持 420×230 品牌、背景與「正在準備工作區…」文字。正常啟動不再建立第二個 Electron 開啟畫面；原生 BMP 持續顯示到主視窗真正可操作。失敗時才建立 Electron 失敗視窗，仍提供原因、重試與退出。啟動畫面不加入動畫或最低停留時間。

## 技術邊界

electron-builder 25.1.8 的 `portable.nsi` 在 `ExecWait` 啟動 Electron 前執行 `BgImage::Destroy`；此版 `NsisTarget` 固定使用內建 `portable.nsi`，`include` 與自訂 installer script 不會套用 portable。專案打包 wrapper 在記憶體中把 `nsisTemplatesDir` 指到暫存的模板複本，替換解壓目錄與啟動交接段：強制使用每次啟動專屬的 `$PLUGINSDIR/app`，在 NSIS 自動顯示標準框前只將該框移出可見桌面，讓獨立的品牌 BMP 留在中央；再由內附 StdUtils 插件取得 app process handle，輪詢本次解壓目錄中的固定就緒標記與 app 存活狀態；看見主視窗或失敗視窗後關閉 BMP，再等 app 結束沿用原清理。實測發現此版 builder 即使 `unpackDirName=false` 仍將打包時產生的固定 KSUID 寫入 `UNPACK_DIR_NAME`，第二次開啟會覆寫仍在執行的第一份 app 而失敗，因此模板須直接忽略該定義。版本與原模板區段均有打包前檢查，未來 builder 變動時停止打包。

StdUtils 的 `ExecShellWaitEx` 回傳 `hProc:XXXXXXXX` 字串，`WaitForProcEx` 自行剖析該格式；輪詢 Win32 `WaitForSingleObject` 時必須先驗證前綴並將後段十六進位值轉成指標，等待結束仍把原字串傳回 StdUtils。直接把整個 `hProc:` 字串當成數值會造成 `WAIT_FAILED`，啟動期間原生畫面無法正常收尾。

## 證據

使用者看過預覽後指出：「如果變成靜態畫面，那這個圓圈是不是就應該拿掉，不然看起來好像卡住，然後動畫的啟動畫面就不用了，應該直接靜態畫面到開啟」，接著明確要求「可以不要閃爍那一下嗎，不能把原本的拿掉直接接到主程式開啟嗎」。本機依據：`node_modules/app-builder-lib/templates/nsis/portable.nsi` 的 `BgImage::Destroy` 與 `ExecWait` 順序；`node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js` 的 portable script 路徑與非 portable 才套用 include 的分支；StdUtils 官方文件記錄 `ExecShellWaitEx` 提供 process handle、`WaitForProcEx` 可等待結束。
