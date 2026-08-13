# 081 完整清理 UI 重新凍結與恢復契約

- 背景：使用者已核准完整清理 UI 定稿與直接實作；T-008 串接時補齊遠端 opt-in、第二階段風險摘要、部分結果待辦與重啟恢復。
- 決定：重新凍結 `BranchCleanupDialog.tsx`，並把新增的 `BranchCleanupRiskDialog.tsx` 納入凍結；後續不得在未重新取得使用者核准時改動兩階段資訊架構與危險確認。
- 恢復契約：多 endpoint 只有部分完成時，未滿足全部 producer 的 remote-tracking ref 屬可重試暫態，不得寫成永久保留 checkpoint；重啟後只跳過已證明完成的 endpoint，全部 producer 收斂後才以 CAS 清理 tracking ref。
- 驗證：真 Electron 覆蓋第一階段零副作用、目前分支先切換、worktree 三種範圍、遠端 tip 變動、多 endpoint 部分失敗、重啟待辦與繼續收斂，並直接查驗 Git refs、worktree 登記與資料夾最終狀態。
