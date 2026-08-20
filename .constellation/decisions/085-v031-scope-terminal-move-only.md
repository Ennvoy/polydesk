# 085 v0.31 範圍收斂：輸入一只做「終端機搬到別的工作區」

- 背景：決議 082 為 v0.31 登記兩組需求。本輪訪談開場實查程式後發現，輸入一內含兩件成熟度不同的事——(A) 外部建立的 worktree 偵測與納管，(B) 終端機搬到別的工作區／worktree。A 的偵測、lineage 驗證與納管鏈路其實已經存在（`WorktreePanel.tsx` 列出該 repo 全部 worktree、未納管者點「切換到此」會走 `worktreeModel.ts` 的 `adopt` 分支、後端再驗 lineage），只差「自動提示」；B 則完全不存在。
- 決定：v0.31 的輸入一**只做 B（終端機搬到別的工作區／worktree）**，不做 A 的自動偵測與自動納管；A 維持現況的手動路徑（SCM → worktree 分頁 → 切換到此 → 確認加入）。
- 原因：A 已可用、只差便利性，屬於錦上添花；B 是零存在的能力缺口，而且 082 已點名它含一個必須先拍板的語意難題（跑中程序的 cwd 無法由外部安全改寫，「搬過去」是換歸屬還是重開 shell）。把本輪工力集中在真缺口，符合使用者「需求規模最小化」的既有偏好。
- 證據：使用者原話「輸入一我只要做B終端機搬到別的工作區」。當時依據為本機實查——`src/shared/channels.ts` 的 `pty:*` 只有 `create`／`resize`／`setVisibility`／`close`／`list`，無任何改歸屬通道；`PtyManager.create` 於建立當下即以 `cwd: ws.path` 綁定工作區；全 repo 搜尋 move terminal／reassign／changeWorkspace 零命中。
