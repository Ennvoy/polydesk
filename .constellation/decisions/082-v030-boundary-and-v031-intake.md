# 082 v0.30 出貨邊界與 v0.31 需求入口

- 背景：v0.30 已進入 ship 複核時，使用者新增兩組需求，並選擇維持本輪出貨邊界、下一版再開發。
- 決定：v0.30 只修正既有完整清理與導覽的出貨 blocker，不混入新功能；完成發布後以 v0.31 開啟新一輪 Constellation 訪談與拆票。
- v0.31 輸入一：偵測 Claude、Codex、Agy 或一般 shell 在外部建立的 Git worktree，驗證 repository lineage、路徑與信任後自動納入工作區；終端機可移動到不同工作區／worktree。功能以 Git repository/worktree identity 與可驗證的 terminal cwd 為準，不依賴 AI 程序名稱。既有執行中程序的 cwd 無法由外部安全改寫，因此需在訪談中定義「只變更歸屬」與「重開於新 cwd」的明確操作語意。
- v0.31 輸入二：Claude、Codex 或 Agy 在 Polydesk PTY 內退出時，保留分頁與 shell，只清理該 AI 啟動後遺留的子程序。暫存研究提出復用既有程序掃描、退出前保存 PID/PPID/creation-time 子孫快照並防 PID 重用；「背景開發伺服器是否一律清除」屬破壞性取捨，須在下一輪訪談以正式決策確認，不直接把 scratchpad 文字視為凍結契約。

> **版本更正（2026-08-20）**：決議文中的「v0.31」為登記當時的預期版號。實際上 v0.31.0 已發布為 symref 撞批修正、v0.32.0 已發布為終端機滾輪修正，故本輪兩項功能實際將落在 v0.33.0 之後。需求內容不受影響。
