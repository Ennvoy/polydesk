# 終端機網址 E2E 定位與 hover 重試附錄

日期：2026-10-12。此附錄是失敗診斷與測試工具修正紀錄，不能作為全量通過證據。

剩餘旅程診斷中的 E2E shard 11/12 回報 `1 failed / 9 passed (2.3m)`，失敗為 `terminal-web-link.spec.ts:86`：hover 的 `currentLink.link.text` 預期 `http://localhost:3000`，實際空字串，超過既有 5000ms 上限。原始輸出已保存在 [remaining-journey-diagnostic.txt](remaining-journey-diagnostic.txt)。此時尚未執行 Ctrl+點擊，前面的固定 IPC／HTTP 與 file 白名單斷言已通過。

root 隨後未改原案例單跑，工具 session `7086` 回報 exit 0，案例 `13.7s`、總計 `14.9s`。該次沒有另存獨立 log 檔，此處誠實引用 root 工具紀錄。原 shard 失敗時沒有保存 buffer／幾何資料；原案單跑通過不能證明當時實際根因，亦不能取代正式全量驗證。

只讀核對已確認測試前提：目前安裝的 xterm `Linkifier.ts:47–49` 在 buffer resize 時清除 currentLink 並標記 resized；`83–85` 以不同 buffer cell 的 mousemove 觸發 hover。原測試只 move 一次，再持續讀 currentLink，沒有重新觸發辨識。它亦以固定 1500ms 等待取代既有尺寸就緒狀態，並以當時 cursorY 推測網址畫面行，未驗證真 buffer 中 marker／URL 的位置。這些是可確認的前提缺口，本次失敗究竟遇到 resize、晚到 PTY 輸出或其他條件仍未確定。

本批只改該 E2E 工具流程：

- 等待既有 `data-initial-size-ready=true`，取代固定 1500ms sleep。
- 保留原本一次 `term.write`，每輪搜尋真 buffer 中完整 `入口🙂 http://localhost:3000`，逐格換算格位，明確驗證中文／emoji 前綴占 7 格。
- 用實際 buffer 行減 viewportY 定位畫面行；每輪重新讀 cell／screen 幾何，再以真實滑鼠移出 URL、移回 URL，讀真正 currentLink，成功後點擊該輪最新點位。
- hover 上限保持 5000ms；不偽造 currentLink、不呼叫 provider callback、不重複注入內容。marker 消失或不能定位就失敗，附 cols／rows／baseY／viewportY／URL 行／rect／initialReady 等診斷。
- 固定 IPC、HTTP／file 白名單，以及原 Ctrl+點擊一次、普通點擊不增加外開的斷言均保持。產品、TerminalView／TerminalPanel、設定與 UI 沒有改動。

本次已實際完成靜態驗證：

- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop --jsx react-jsx --types node e2e/terminal-web-link.spec.ts`：exit 0。
- HEAD／修改檔靜態比較：原白名單區塊與 Ctrl／普通點擊後半段內容相同，hover 仍 5 秒，仍僅一次原 term.write 與一次 Ctrl mouse click，exit 0。
- `git diff --check`：exit 0。

本次沒有啟動 GUI 或重建產品。新案例重複三次、Git 分支首案例複核與最終正式全量仍待 root 執行；沒有 full green、commit、push 或 dist 宣稱。
