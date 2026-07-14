# Polydesk

> 多工作區開發終端機 — 把「多個專案的終端機、編輯器、Git、AI 狀態」收進同一個桌面工具。

Polydesk 是以 Electron 打造的桌面應用，專為「同時開多個專案、每個專案各自跑 AI CLI（Claude Code / Codex / Agy）」的工作流設計。一個視窗管理所有工作區的終端機、程式碼、版本控制與 AI 執行狀態。

支援平台：**Windows**（zh-TW 環境最佳化，全程 UTF-8）。

---

## ✨ 主要功能

| 功能 | 說明 |
| --- | --- |
| **多工作區** | 左側工作區列（可顯示/隱藏）切換專案，每個工作區獨立狀態；重設版面一鍵還原。 |
| **終端機多開** | 同一工作區可並排/上下多開終端機、可拖曳調整，支援 PowerShell 等 shell；選取文字後可用 `Ctrl+C` 在終端機間複製貼上，未選取時仍送出中斷訊號。 |
| **Monaco 編輯器** | 多分頁、分割並排、與磁碟版本衝突偵測（只在關檔時提醒、不打斷）。 |
| **Git 原始碼控制** | status / stage / commit / push / pull / stash / branch / log / diff；**AI 產生 commit message**（可切換 claude / codex / agy 引擎）。 |
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
3. 左上「＋」新增工作區（選一個專案資料夾）即可開始：開終端機、編輯檔案、跑 Git、看 AI 狀態。

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
