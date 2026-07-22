# Polydesk

![version](https://img.shields.io/badge/version-v0.7.0-blue) ![platform](https://img.shields.io/badge/platform-Windows-informational)

> 多工作區開發終端機 — 把「多個專案的終端機、編輯器、Git、AI 狀態」收進同一個桌面工具。

Polydesk 是以 Electron 打造的桌面應用，專為「同時開多個專案、每個專案各自跑 AI CLI（Claude Code / Codex / Agy）」的工作流設計。一個視窗管理所有工作區的終端機、程式碼、版本控制與 AI 執行狀態。

支援平台：**Windows**（zh-TW 環境最佳化，全程 UTF-8）。

---

## ✨ 主要功能

| 功能 | 說明 |
| --- | --- |
| **多工作區** | 左側工作區列（可顯示/隱藏）切換專案；可加入既有資料夾，或透過 HTTPS／SSH Clone Git Repository 後直接開啟；GitHub 私有倉庫支援瀏覽器登入帳號並自動重試；每個工作區獨立狀態。 |
| **終端機多開** | 同一工作區可並排/上下多開終端機、可拖曳調整，支援 PowerShell 等 shell；工具列可一鍵建立並啟動 Claude bypass、Codex 或 Agy，且會核對 xterm 與 ConPTY 的實際欄列一致後才啟動 TUI，尺寸套用失敗會自動重試，避免首屏或版面切換後跑版；選取文字後可用 `Ctrl+C` 在終端機間複製貼上，未選取時仍送出中斷訊號；按住 `Ctrl` 點擊輸出的檔案路徑，可直接開檔並跳到指定行欄。 |
| **Monaco 編輯器** | 多分頁、分割並排、依視窗寬度自動換行，以及磁碟版本衝突偵測（只在關檔時提醒、不打斷）；即使關閉整個編輯器面板，從側欄點檔也會一次重建並開啟。 |
| **Git 原始碼控制** | status / stage / commit / push / pull / stash / branch / log / diff；SCM、活動列與狀態列共用單次 Git 快照，開啟面板與切換分支不再重複掃描工作樹；整合終端機或外部工具完成 commit / push 後會自動同步分支與未推送狀態；**AI 產生 commit message**（可切換 claude / codex / agy 引擎）。 |
| **檔案總管** | VSCode 風右鍵編輯（新增/改名/刪除/剪貼）；**從系統剪貼簿 Ctrl+V 貼入外部檔案**；刪除**移到資源回收桶**（可救回）。 |
| **試算表預覽** | `.xlsx / .xls` 直接渲染成表格（Excel 風欄標＋列號、多工作表切換），不再是二進位亂碼。 |
| **AI 狀態監控** | 以真實 process 與工具事件偵測各工作區狀態；Claude / Codex 支援細分狀態，Agy 第一版提供「執行中 / 未啟動」徽章。 |
| **總覽面板** | 一鍵最大化總覽：各工作區 Claude / Codex / Agy 狀態，以及 Claude / Codex 服務用量（5 小時 / 每週額度；Agy CLI 未提供可讀取用量，因此不顯示用量卡）。 |
| **三主題** | 深色 / 淺色 / 暖色，字型統一 Geist，切換不跳版面。 |
| **搜尋 / LSP** | 內建 ripgrep 全文搜尋、Language Server 診斷。 |

---

## 🚀 如何使用（免安裝版）

1. 到 [Releases](../../releases) 下載 `Polydesk-<version>-portable.exe`。
2. **雙擊直接執行**——免安裝、不寫入系統。
3. 左上「＋」可新增既有工作區或 Clone Git Repository；GitHub 私有倉庫若尚未授權，失敗提示會提供「使用瀏覽器登入 GitHub 並重試」。
4. 登入流程需要 [GitHub CLI](https://cli.github.com/)；Token 由 `gh` 與 Windows 憑證庫保管，Polydesk 不會讀取或保存。Clone 完成後即可開終端機、編輯檔案、跑 Git、看 AI 狀態。

終端機面板右上方提供三個 AI CLI 快捷按鈕：`Claude bypass` 會執行 `claude --dangerously-skip-permissions`，`Codex` 會執行 `codex`，`Agy` 會執行 `agy`。每次點擊都會建立一個獨立終端機，沿用目前工作區選定的 shell；Polydesk 會等 xterm 與 Windows ConPTY 回報相同欄列後才啟動工具，若尺寸未實際套用則自動重試，避免 Claude 等 TUI 先用錯誤欄寬排版。Claude bypass 會略過所有工具與檔案操作的權限確認，只能在你完全信任的工作區使用。

### 從終端機開啟檔案

將滑鼠移到終端機輸出的檔案路徑，路徑會顯示底線；按住 `Ctrl` 再點擊即可開啟。支援 Windows 絕對路徑、`~\...` 家目錄路徑、工作區相對路徑，以及 `path:line`、`path:line:column` 定位格式；含空白的路徑請以單引號或雙引號包住。

- 工作區內檔案會在 Polydesk 編輯器開啟；若路徑包含行號與欄位，游標會直接跳到該位置。
- 相對路徑以終端機啟動時的工作區根目錄為準；若已在 shell 內 `cd` 到其他位置，請使用絕對路徑。
- 工作區外檔案（例如 Claude 產生在暫存目錄的截圖）會先顯示完整路徑並要求確認，確認後才交給 Windows 預設程式開啟。
- 為避免終端輸出變成任意程式啟動入口，執行檔、腳本、安裝包、捷徑、UNC／裝置路徑與 NTFS alternate data stream 不允許從連結啟動。

> Portable 版把整個 app 打包成單一 exe，第一次啟動會解壓到暫存資料夾，稍等幾秒屬正常。

---

## 🛠️ 開發

需求：Node.js 20+、Windows。

```powershell
npm install          # 安裝相依
npm run dev          # 開發模式（electron-vite，熱更新）
npm run typecheck    # TypeScript 型別檢查
npm run test         # 單元測試（vitest）
npm run e2e          # 端對端測試（Playwright + Electron）
```

### 打包

```powershell
npm run dist         # 打包成 Portable exe → ../polydesk-dist/Polydesk-<version>-portable.exe
npm run pack:dir     # 未壓縮 app 目錄 → ../polydesk-dist/win-unpacked（除錯用）
```

### 交付流程

每次完成調整並通過驗證後，先同步 `CHANGELOG.md` 與本 README，再依序 commit、push、執行 `npm run dist`。正式交付時應核對 portable exe 的路徑、檔案大小與 SHA-256，確保程式碼、文件與可執行產物屬於同一版歷程。

### Git 狀態同步

原始碼控制面板開啟期間，Polydesk 會以低頻、僅讀取狀態的方式檢查目前 `HEAD`、分支及 ahead / behind。即使 commit 或 push 是在整合終端機、外部終端機或其他 Git 工具完成，面板也會自動更新，不必手動重新整理。

狀態、變更清單、活動列數字與底部狀態列會共用同工作區的一次 Git 快照；同時發生的讀取只啟動一個查詢。分支清單也以單一 Git 指令取得本地分支、遠端分支與目前分支，降低 Windows 上 Git 程序啟動較慢時的累積等待。

歷史頁的遠端分支使用固定寬度雲端圖示，避免長名稱壓縮 commit 主旨；將滑鼠停留在圖示上仍可查看完整遠端分支名稱。

---

## 🧱 技術棧

- **殼層**：Electron 33 + electron-vite + electron-builder
- **UI**：React 19、dockview（可停靠版面）、Monaco Editor、xterm.js（終端機）
- **後端能力**：node-pty（ConPTY 終端）、@vscode/ripgrep（搜尋）、SheetJS/xlsx（試算表）、iconv-lite + jschardet（編碼偵測）
- **架構**：main / preload / renderer 三層，IPC 單一真相型別表，contextIsolation + sandbox
- **測試**：vitest（單元）+ Playwright（真實 Electron e2e）

---

## 📄 License

[MIT](LICENSE) © 2026 Ennvoy

版本變更請參閱 [CHANGELOG.md](CHANGELOG.md)。
