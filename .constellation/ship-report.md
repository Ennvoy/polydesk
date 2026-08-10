# 標頭關閉維持側欄尺寸出貨報告

## 做了什麼

- dockview 標頭 `×` 由 Polydesk 接管，側欄、編輯器與終端機統一走 group `setVisible` 原地顯隱，不再 remove panel。
- 編輯器／終端機顯隱前記住側欄實際寬高，dockview 重分配空間後立即設回；上方版面按鈕、檢視選單與面板內關閉入口共用同一路徑。
- editor／terminal component 不再因標頭關閉而 dispose，叫回後沿用原本 panel 實例與工作狀態。
- 版本同步至 v0.25.0，README、CHANGELOG、內建 release notes、tasks、MAP 與 HISTORY 均已更新。

## 驗了什麼

- 修正前真 Electron 回歸重現：按編輯器標頭 `×` 後側欄寬度漂移 49 px。
- TypeScript typecheck、正式 build 與完整序列 Vitest 通過：66 個測試檔、565/565 案全綠。
- 真 Electron E2E 依 12 個單 worker shard 執行：109 案中 106 通過，3 個需真 Agy／Codex 帳號的 dogfood 案例依既有條件跳過；`REQ-PERF-001` 沿用既有核准豁免。
- 新增 `layout-close-size` 回歸覆蓋編輯器與終端機標頭 `×`、側欄寬高與 panel DOM 原地保留；既有 editor reveal、terminal header／toggle 與 reset layout 旅程全綠。
- 效能門檻通過：四工作區串流 frame p95 18.2 ms、renderer CPU 2.3%；worktree 列表 p95 179 ms、建立 884 ms。

## 證據在哪

- 功能提交：待回填。
- 尺寸保留與顯隱契約：`src/renderer/layout/layoutPersist.ts`、`src/renderer/layout/layoutPersist.test.ts`。
- dockview 標頭接管：`src/renderer/layout/DockLayout.tsx`。
- 真 Electron 回歸：`e2e/layout-close-size.spec.ts`、`e2e/editor-reveal-on-open.spec.ts`、`e2e/terminal-header.spec.ts`。
- 版本與使用說明：`src/shared/releaseNotes.ts`、`README.md`、`CHANGELOG.md`。
