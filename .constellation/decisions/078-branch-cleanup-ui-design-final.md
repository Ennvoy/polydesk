# 078 分支完整清理 UI 定稿

- Claude Design：未使用。Chrome 專用控制插件與 Windows 介面控制 runtime 都在建立連線前失敗；使用者在得知落差後明確選擇「允許直接實作」。
- 設計基底：Polydesk 既有 `DialogHost`、`pd-btn`、SCM 分支列、暗色 tokens、字級與間距；不新增另一套導航或視覺語言。
- 需求描述：從本地分支既有更多／右鍵選單進入單一路徑，第一階段選本機、目前分支切換、worktree 與 opt-in 遠端範圍；第二階段才顯示 live Git 風險並最終確認。主工作樹不當成可刪 worktree，遠端預設不選，所有破壞性動作在第一階段都尚未開始。
- 方向數：一版——照既有 SCM 資訊架構做，未製造平行頁面或假選項。
- 使用者定稿：使用者檢視 1280×768 真 Electron 截圖後回覆「定稿」。
- 調整：第一次視覺檢查後排除主工作樹誤列，並把動作列固定於低高度視窗底部；定稿版完整顯示範圍、警告、取消與「檢查清理風險」。
- 落地：畫面本來就在 repository React/CSS 中，沒有 `.dc.html` 拉回或格式轉譯；資料來源接現有真分支、worktree 與 remote-tracking snapshot，build 階段再以新 cleanup preview/execute IPC 取代暫時的安全刪除接縫。沒有 Tweaks、假 API 或假資料殘留。
