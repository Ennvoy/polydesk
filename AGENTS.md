# Repository Guidelines

## 專案結構與模組

Polydesk 是 Electron、React 19 與 TypeScript 專案。`src/main/` 放主程序、PTY、檔案與 Git 服務；`src/preload/` 提供受限 IPC bridge；`src/renderer/` 放 React UI、Monaco、xterm 與版面元件；跨程序型別與 channel 集中於 `src/shared/`。單元測試與程式並置為 `*.test.ts`，整合素材位於 `tests/`，Electron 端到端測試位於 `e2e/*.spec.ts`。`build/` 保存圖示與封裝腳本，`specs/` 保存需求、架構與工作清單；`out/`、`test-results/` 為產物，不應手動編輯。

## 開發、建置與測試

- `npm run dev`：啟動 electron-vite 開發模式。
- `npm run typecheck`：以嚴格 TypeScript 設定檢查，不產生檔案。
- `npm test`：執行 Vitest 單元與整合測試。
- `npm run build`：產生 `out/` 正式建置。
- `npm run e2e`：以 Playwright 啟動已建置的 Electron；修改原始碼後必須先執行 build。
- `npm run dist`：建立 Windows portable exe 至 `../polydesk-dist/`。

Windows 若 `npm.ps1` 被執行原則阻擋，改用 `cmd /c npm ...`。中文實體路徑可能干擾 Vite／Playwright；測試優先從 `C:\polydesk-dev` ASCII junction 執行。

## 程式風格與命名

使用 2 空格縮排、單引號、分號及嚴格型別；避免 `any` 與未使用參數。React 元件、類別使用 `PascalCase`，函式、變數使用 `camelCase`，常數使用 `UPPER_SNAKE_CASE`。IPC channel 與 request/response 型別必須先在 `src/shared/` 定義。專案未設定獨立 formatter／lint script；提交前至少執行 typecheck 與 `git diff --check`。

## 測試準則

Vitest 測試命名為 `*.test.ts`；Playwright 測試命名為 `*.spec.ts`。修 bug 時加入可先重現失敗、修後通過的回歸案例。E2E 使用真實 IPC、檔案系統與 Git，避免不必要 mock，並在測試結束清理暫存目錄。

## Commit 與 Pull Request

Commit 使用 Conventional Commits：`feat/fix/chore/refactor/docs/test(scope): 繁中摘要`。訊息共 2–4 行，後續以 `- ` 說明具體調整、原因、影響範圍及風險。PR 應附變更摘要、驗證指令、相關 issue／spec；UI 修改附前後截圖，設定或封裝變更列出重建、環境變數與部署注意事項。

## 發布與歷程紀錄

每次完成程式、介面或設定調整並通過驗證後，必須先更新 `CHANGELOG.md` 與 `README.md`，再依序執行 commit、push 與 `npm run dist`。Changelog 應記錄日期、使用者可感知變化、原因、影響範圍與已存在的短 commit hash；README 應同步目前功能、使用方式或開發流程。打包完成後回報 portable exe 路徑、檔案大小與 SHA-256。除非任務明確要求，勿把 `.flow` journal／ledger 的非產品變更混入功能 commit。

## 安全與設定

維持 `contextIsolation` 與 sandbox，不向 renderer 暴露原始 `ipcRenderer`、Node API 或任意 shell。新增 IPC 必須使用固定白名單 channel、驗證工作區與路徑；PTY shell、拖放路徑及外部 CLI 輸入皆需保留既有 allowlist 與清理策略。不要提交憑證、token、使用者資料或本機路徑設定。
