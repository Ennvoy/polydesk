# Polydesk 專案指引

## 版本釋出規則（2026-07-15 拍板，每批交付必做）

每完成一批 dogfood／功能交付（如 DF-N 修復批次）收尾時，SHALL 一併：

1. `package.json` version minor bump（如 0.2.0 → 0.3.0）。
2. `src/shared/releaseNotes.ts` 頂端加同版本節（版本顯示唯一來源；`releaseNotes.test.ts` 會擋兩處不同步，紅燈就是忘了哪邊）。
3. `CHANGELOG.md` 補該版本分節（`## vX.Y.Z（日期）` 傘節＋日期子節）。
4. README 版本徽章同步（`version-vX.Y.Z-blue`）。
5. commit 後打 annotated tag `vX.Y.Z` 並 `git push --tags`（portable 檔名 `Polydesk-${version}-portable.exe` 由 electron-builder 自動帶版本）。

版本呈現入口：標題列「說明 → 關於 Polydesk」與狀態列右下版本鈕（皆讀 `releaseNotes.ts`，勿另立來源）。

## 導覽與使用說明同步規則（2026-08-10 拍板）

任何使用者可見功能的新增、變更或移除，SHALL 同步檢查並更新首次／手動教學導覽與程式內完整使用說明，包含入口位置、操作步驟、畫面狀態、錯誤處理與高風險提示。若某次改動確實不影響導覽或說明，也必須在驗證結果中明確確認，不得默默略過。

導覽與使用說明屬功能完成定義的一部分：相關內容、導覽目標 selector／步驟與回歸測試必須和產品程式在同一批變更內更新並一起驗證，避免文件或指引落後實際介面。
