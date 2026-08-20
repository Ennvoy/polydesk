# 095 改用 ConPTY console process list 辨識與清理殘留，取代背景帳本

- 背景：實測發現 AI 工具（Claude Code 等）每執行一次指令即開新 shell、執行完即結束，其啟動的背景程序在該次指令結束當下即成孤兒，與 AI 是否退出無關。此發現推翻決議 090「每 8 秒背景掃描帳本」的可行性——AI 指令常於一至二秒內結束，取樣間隔內無從記錄祖先關係。另查 node-pty 內建 `getConsoleProcessList`（ConPTY 原生能力，依 console 附著關係而非父子鏈），且 `PtyManager.disposeTerm` 目前先 `treeKill` 再 `pty.kill()`，順序導致 shell 先死、console 清單撈空，內建防護形同失效。
- 決定：改以 ConPTY console process list 作為「該終端機底下有哪些程序」的唯一依據，關閉時即時查詢；並修正清理順序為**先終止 console 清單成員、再 `treeKill` 補刀**。**廢除背景帳本設計**：不再每 8 秒掃描、不再維護帳本、不再需要 PID 重用防護。ConPTY host 程序須排除，不得一併終止。
- 原因：本機對照實測證實此路線有效且成本極低——同一 rig、同一孤兒形狀，現況順序下孤兒存活，修正順序下清除乾淨。同時消除背景帳本帶來的全部衍生風險（取樣漏列、PID 重用誤殺、跨終端機誤殺、每 8 秒新增全機列舉負擔）。已知限制為明確脫離 console 的程序（如 `Start-Process -WindowStyle Hidden`）不在清單內，此類無法辨識亦無法歸屬，本輪不處理並須誠實揭露。
- 證據：使用者於彈窗選擇「先驗便宜方案再決定（推薦）」。實測數據——現況順序：孤兒 `pid=8532 ppid=17332 parentAlive=False`，`CONSOLE_PROCESS_LIST=[29332,8532,688]` 含該孤兒，`taskkill /T /F` 後孤兒仍存活；修正順序：孤兒 `pid=36680`，先終止 console 成員後查詢結果為 `NONE`。反例：`Start-Process -WindowStyle Hidden` 起的 `pid=28328` 不在 `CONSOLE_PROCESS_LIST=[7880,35604]` 內。
- 取代：本決議取代 090、091；092 的「全部存活子孫」重新定義為「console 清單成員」。
