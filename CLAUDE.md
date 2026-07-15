# Polydesk 專案指引

## 版本釋出規則（2026-07-15 拍板，每批交付必做）

每完成一批 dogfood／功能交付（如 DF-N 修復批次）收尾時，SHALL 一併：

1. `package.json` version minor bump（如 0.2.0 → 0.3.0）。
2. `src/shared/releaseNotes.ts` 頂端加同版本節（版本顯示唯一來源；`releaseNotes.test.ts` 會擋兩處不同步，紅燈就是忘了哪邊）。
3. `CHANGELOG.md` 補該版本分節（`## vX.Y.Z（日期）` 傘節＋日期子節）。
4. README 版本徽章同步（`version-vX.Y.Z-blue`）。
5. commit 後打 annotated tag `vX.Y.Z` 並 `git push --tags`（portable 檔名 `Polydesk-${version}-portable.exe` 由 electron-builder 自動帶版本）。

版本呈現入口：標題列「說明 → 關於 Polydesk」與狀態列右下版本鈕（皆讀 `releaseNotes.ts`，勿另立來源）。
