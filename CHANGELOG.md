# Polydesk 更新旅程

本文件依 Git 歷史整理 Polydesk 從專案骨架到目前 dogfood 版本的演進。內容以使用者可感知的功能、修正、安全性、效能及驗證為主；單純同步 `.flow` journal、ledger 或回填 SHA 的維護 commit 不另列為產品更新。

- 歷史範圍：2026-06-28 起
- 來源：`git log --reverse --no-merges`
- 內部需求、驗證與 dogfood 編號：[`specs/tasks.md`](specs/tasks.md)
- 版本規則（2026-07-15 拍板）：以**版本分節**整理，每完成一批交付即 minor bump＋打 tag＋本檔補節；app 內版本顯示的唯一來源是 `src/shared/releaseNotes.ts`（單測釘死與 `package.json` 同步）。

## v0.9.0（2026-07-23）

終端檔案連結可靠性批次：修正中文與 emoji 造成連結裝飾、點擊命中錯位，並降低一般終端文字被誤判為路徑的情況。

### 2026-07-23｜修正終端檔案連結錯位與誤判

- 病根：路徑解析器回傳的是 JavaScript 字串索引，但 xterm 的連結範圍與滑鼠命中使用終端格位；中文字、全形字與 emoji 會佔兩格，出現在路徑前方時，底線與 Ctrl+點擊區域便會向左偏移，畫面看似有連結卻打不開。
- 修法：逐格讀取 xterm buffer 的字元與寬度，把解析結果換算為實際起訖格位；LinkProvider 裝飾與 host capture 點擊共用同一組格位結果，不再各自用字串索引猜位置。
- 相對路徑判定同步收緊：未以 `./`、`../` 開頭的相對 token 必須具備檔案副檔名，避免 `N/A`、`workflow/subagent`、`API/資料表` 等說明文字被畫成無法開啟的假連結；Windows 絕對路徑、家目錄、明示相對路徑、行欄定位與含空白引號路徑維持支援。
- 驗證：路徑解析單元測試 5 案、typecheck、正式 build，以及含「中文＋emoji＋相對路徑＋行欄」的真 Electron Ctrl+點擊 E2E 與工作區外安全開啟 E2E 共 2 案全綠。

## v0.8.0（2026-07-22）

快捷啟動首屏穩定批次：修正 Claude bypass 偶發歡迎橫幅殘影——啟動命令改等終端尺寸靜置穩定（含字型就緒）後才送出。

### 2026-07-22｜修正 Claude bypass 偶發首屏殘影（尺寸穩定窗）

- 病根：v0.7.0 之後啟動命令已等「首次 resize 確認」，但掛載後零點幾秒內版面仍可能再變一次（版面收斂尾巴、字型載入改變格寬、resize 失敗 350ms 補送）；遲到的 resize 撞上 Claude 繪製靜態歡迎橫幅，橫幅便以舊寬度定格成殘影（動態輸入區會重畫、靜態區不會）。
- 修法：`TerminalView` 把啟動閘門從「首次確認」升級為「穩定窗」——尺寸確認套用後靜置 250ms 無再變動、且字型 `fonts.load` 已決議，才通知快捷啟動器送出命令；期間任何新尺寸確認重新計時，同尺寸重複確認不重置倒數，倒數到點再核對當下欄列。
- 快捷啟動因此約慢 0.25 秒；手動終端機、後續版面調整與既有 resize 失敗重試、輸出自癒行為不變。
- 驗證：typecheck、完整 Vitest、正式 build，AI launch 真 Electron E2E 補「命令送出後短窗內欄數不得再變」回歸全綠。

## v0.7.0（2026-07-22）

終端尺寸同步可靠性批次：修正快捷啟動與版面切換時，IPC 已回覆但 ConPTY 實際 resize 失敗，導致 Claude 等 TUI 仍按舊欄寬繪製並被右側裁切。

### 2026-07-22｜修正 Claude 歡迎畫面偶發沿用舊欄寬

- `pty:resize` 回應新增實際套用狀態與目前欄列；main process 只有在 node-pty resize 成功後才回報 `applied: true`，不再把捕捉到的 ConPTY 例外包成假成功。
- AI 快捷啟動會逐一核對 xterm 要求的欄列與 ConPTY 已套用欄列，完全一致才送出 Claude／Codex／Agy 命令；首次失敗會延後重試，不讓 TUI 在錯誤尺寸下啟動。
- 終端機啟動後若工作區列、側欄、編輯器或最大化切換造成 resize 暫時失敗，即使畫面沒有後續輸出也會主動重試，避免靜止的歡迎畫面永久卡在舊欄寬。
- 回歸測試新增 resize 失敗回應契約，以及假 Claude 從真實 PTY 回報欄數並與 xterm 對賬；PtyManager 21 案、typecheck、正式 build 與 AI launch Electron E2E 皆通過。

## v0.6.0（2026-07-21）

AI CLI 快捷啟動批次：終端機面板直接提供 Claude bypass、Codex、Agy 三個入口，不必先新增終端機再手動輸入啟動文字。

### 2026-07-22｜加速 SCM 讀取與分支切換

- SCM 改用單次 `git:snapshot` 同時取得分支狀態與變更清單；活動列、底部狀態列與 SCM 面板的同工作區並行讀取再以 single-flight 合併，不再各自把重複的 `git status` 塞進序列佇列。
- 自動／手動 fetch 直接沿用最新快照判斷 remote，不再為判斷是否需要 fetch 額外掃描一次工作樹；背景狀態探測取得的快照也直接更新畫面，不再偵測到變動後重查。
- 分支清單由三個 Git 程序合併成單一 `for-each-ref`，一次取得本地、遠端與目前分支；成功 checkout 後直接以新快照更新目前分支，不再追加整份 branch list 查詢。
- 實測問題工作區只有 292 個追蹤檔案，但單次 Git 程序在目前 Windows 環境仍需約 1–4 秒，因此本修正以減少程序數與佇列等待為主，不透過忽略 `.flow` 等變更犧牲正確性。
- 驗證包含 snapshot／single-flight／branch list 指令數回歸、完整 Vitest 60 檔 525 案、typecheck、正式 build，以及真 Electron 的 SCM 徽章與 dirty／untracked 分支切換共 5 案。

### 2026-07-22｜終端機檔案路徑可直接開啟

- 終端機輸出的 Windows 絕對路徑、`~\...`、工作區相對路徑及 `path:line:column` 現在會顯示為可互動連結；按住 `Ctrl` 點擊後，工作區內檔案會在 Polydesk 編輯器開啟並跳到指定行欄。
- Claude 等工具產生在工作區外的截圖或一般檔案，會先由主程序顯示完整路徑並要求確認，確認後才交給 Windows 預設程式；取消為預設選項。
- 外部連結只接受既有一般檔案，並封鎖執行檔、腳本、安裝包、捷徑、UNC／裝置路徑與 NTFS alternate data stream；renderer 仍只取得固定白名單 IPC，不暴露 Node 或原始 `ipcRenderer`。
- 新增路徑解析單元測試、主程序 containment／危險類型測試及真 Electron E2E；另回歸終端剪貼簿、SIGINT、OSC52、右鍵 TUI 與多終端管理共 13 案。

### 2026-07-22｜修正快捷啟動 Claude 首屏跑版

- 修正點擊 `Claude bypass` 時，Claude 先以 ConPTY 預設 `80x24` 排版、隨後才切換到面板實際尺寸，造成歡迎畫面與提示區塊橫向錯位；手動輸入因終端早已完成 fit，故不會出現同樣問題。
- Claude／Codex／Agy 快捷命令現在一律等 xterm 完成首次有效 fit，且 PTY resize IPC 完成後才送出；一般手動建立終端機與後續尺寸自癒流程不變。
- 更新真 Electron／PowerShell E2E，確認三個快捷終端機皆先進入「首次尺寸已同步」狀態才收到命令；另回歸尺寸自癒、底列可視性與裁切共 5 案。

### 2026-07-21｜終端機 AI CLI 一鍵啟動

- 點擊任一快捷按鈕會沿用目前選定的 shell 建立獨立終端機，自動命名為對應工具，並送出 `claude --dangerously-skip-permissions`、`codex` 或 `agy`。
- 啟動命令會等待 TerminalView 掛載、開始接收 PTY 資料並完成首次有效尺寸同步後才送出，避免初始輸出遺失或 TUI 先按預設 `80x24` 排版而跑版。
- Claude 按鈕明確標示 `bypass` 並使用警示色與風險說明；此模式略過所有權限確認，只適合完全信任的工作區。
- 新增真實 Electron／PowerShell E2E：以隔離暫存 PATH 的假 CLI 驗證三個按鈕、終端命名、真 PTY 命令執行與 Claude bypass 參數；既有終端管理 5 案亦全數通過。

## v0.5.0（2026-07-20）

GitHub 私有倉庫 Clone 批次：已有 `gh` 登入狀態時直接沿用帳號權限；未登入時提供瀏覽器登入並自動重試，不再只顯示 Git Credential Manager／SSH 的泛用錯誤。

### 2026-07-20｜GitHub 私有 Repository 登入與 Clone

- Clone GitHub HTTPS URL 前會檢查 GitHub CLI 登入狀態；已登入時改由 `gh repo clone` 使用帳號權限，並關閉 fork 自動新增 upstream，保持原本 `git clone` 行為。
- 未登入或未安裝 `gh` 時仍先以原生 Git Clone，確保公開倉庫不被強迫登入；只有 GitHub 認證失敗時才顯示「使用瀏覽器登入 GitHub 並重試」。
- 登入採 `gh auth login --web --clipboard` 官方 device flow，一次性 code 自動複製到剪貼簿，Token 由系統憑證庫保管，Polydesk 不讀取、不儲存，也不把憑證放進 URL 或程序參數。
- 新增 GitHub URL 分流、既有登入 Clone、瀏覽器登入參數與缺少權限分類回歸測試；typecheck、517 案 Vitest、正式 build 與工作區 E2E 4 案通過。

## v0.4.0（2026-07-15）

未拉取可視化批次：遠端有新 commit 不再無感——SCM 以事件驅動 fetch（⟳ 重新整理與切工作區觸發、不背景輪詢）更新遠端狀態，同步列與 pull 鈕出現「↓N 未拉取」數字提示。v0.4.0 tag 打在本版收尾提交。

### 2026-07-16｜終端機持續輸出自癒與編輯器自動換行

- `7e7bdd7` 補強 Claude workflow 長時間維持焦點時的終端尺寸同步：輸出期間節流重送 xterm 實際列數，短促輸出也以 trailing 校正補做，避免底部任務區畫到可視範圍外。
- Monaco 編輯器改為依目前視窗寬度自動換行，並採用進階中英文分行規則；縮窄視窗或調整面板後不再需要水平捲動才能讀完整行。
- 修正使用 dockview 分頁的 × 關閉整個編輯器後，第一次從側欄點檔只會重建空面板、必須再點一次才開檔；editor bus 現在會保留請求並在 EditorGroup 掛載後補送一次。
- 新增根目錄 `AGENTS.md` 貢獻指南，並將「驗證後先更新 CHANGELOG／README，再 commit、push、打包與核對 SHA-256」定為固定交付流程，避免功能、文件與 portable 產物版本脫節。

### 2026-07-15｜未拉取數字提示與事件驅動 fetch

- 未拉取提示（PE-4）：同步列 behind>0 顯示「↓N 未拉取」強調字、pull 鈕右上角數字角標（與未推送同款）；數字來源是 `git fetch` 後的 remote-tracking ref——fetch 只更新遠端狀態，不動工作樹、不自動合併。
- 事件驅動 fetch：按 ⟳ 重新整理順便取回（本地刷新先行、不等網路）；切工作區自動取回（同工作區 60 秒冷卻，連切不狂觸網）。拍板不做背景定時輪詢——平常零觸網（VS Code 預設也關 autofetch，同一派）。
- 取回失敗（離線／認證）不跳錯誤橫幅：自動路徑靜默、手動路徑於同步列下方顯示小字提示，成功即清。

## v0.3.0（2026-07-15）

發佈到 GitHub 與 push 體驗批次：GitHub 還沒建 repo 也能從 Polydesk 一鍵發佈（VS Code「Publish to GitHub」同款體驗、以 gh CLI 實作故 app 不碰 token）。v0.3.0 tag 打在本版收尾提交。

### 2026-07-15｜發佈到 GitHub 與 push 智慧補救

- 發佈到 GitHub（DF-12）：SCM 同步列偵測「沒有 remote」時顯示「發佈」——對話框選名稱與公開／私有後，gh 建 repository、設 origin、推送一氣呵成；gh 未裝／未登入／名稱已存在皆給人話引導。
- push 智慧補救：新分支沒 upstream 自動改跑 `push -u`（不再噴 fatal 原文）；失敗分類為認證／網路／逾時／無 remote／遠端 repo 不存在，SCM 錯誤區給對應指引。

## v0.2.0（2026-07-15）

第二功能批次：Git 工作流（Clone、外部狀態同步）、AI 狀態整合（Codex／Agy）、跨終端複製、終端機輸出跟捲自癒，以及版本可視化（「關於」視窗＋狀態列版本＋本檔版本分節）。v0.2.0 tag 打在本版收尾提交。

### 2026-07-15｜終端機輸出跟捲自癒與版本可視化

- `1b28bb3` 修正 claude 展開 Shell details 後底部被吃掉：xterm 6 孤兒 `isUserScrolling` 旗標會把大量輸出時的 viewport 凍在原地，TerminalView 加自癒不變量「寫入前在底部 ⇒ 寫入後仍在底部」（DF-11）。
- 版本可視化（PE-3）：版本跳 0.2.0；「說明 → 關於 Polydesk」顯示版本與近版重點、狀態列右下常駐版本號；`releaseNotes.ts` 單測擋版本不同步。

### 2026-07-14｜Git 工作流、AI 狀態與跨終端操作

- `4cc6b84` 修正 Monaco 貼上焦點與 `Ctrl/Cmd+V` 攔截，並在 SCM 顯示目前工作區的未提交檔案數。
- `0d7be5f` 調整歷史列伸縮規則，避免長 commit 主旨壓縮徽章；同時依額度週期正確標示 Codex 用量。
- `f4d2b86` 整合 Agy commit 訊息引擎、程序與日誌解析，補齊 Codex／Agy 執行中、待確認、已停止狀態及總覽聚合。
- `d0d2231` 讓終端機有選取文字時可用一般 `Ctrl/Cmd+C` 複製到另一個終端機，未選取時仍保留 SIGINT。
- `1013c23` 新增 HTTPS／SSH Clone Git Repository，完成後自動納管並開啟工作區，並補上路徑、認證、網路與逾時錯誤分類。
- `2ba1d69` SCM 改以低頻 status-only 探測 `HEAD`、分支及 ahead／behind，外部 commit 或 push 後可自動刷新；遠端 ref 改為固定寬度雲端圖示並保留 tooltip／aria 名稱。
- `84e9684` 補齊 README、DF-10 與本更新旅程的文件入口。

### 2026-07-11｜Git 歷史徽章去重

- `88aa77e` 過濾 `<remote>/HEAD` 符號 ref，避免遠端預設分支在歷史面板顯示兩顆內容重複的徽章。

### 2026-07-10｜編輯器叫回與版面落檔

- `aa244d0` 硬化從側欄或 SCM 開檔時的編輯器叫回鏈：隔離 bus listener 錯誤、重新顯示隱藏面板、切到正確 dock tab，並涵蓋 diff 分頁。
- `b02723a` 關窗與退出前同步保存當下 dockview 狀態，修正快速切換面板後立即離開導致版面設定遺失。

### 2026-07-09｜拖放匯入與終端機自癒

- `dcb5a75` 找到 Claude TUI 右鍵偶發雙貼的根因，阻擋右鍵滑鼠回報進入 PTY，只保留一次實際貼上。
- `d198eb3` 支援從 Windows 檔案總管把檔案或資料夾拖入 Explorer，依游標位置匯入工作區並處理重名。
- `04b83c4` 建立 PTY 與 xterm 尺寸自癒同步，resize 失敗可重試，修正 Claude 展開內容時底部輸入區被裁掉。

### 2026-07-08｜拖曳路徑、剪貼簿與完整退出

- `927f7a3` 支援從 Explorer 或作業系統拖檔到終端機，自動依 PowerShell、cmd、Git Bash、WSL 產生安全引用的絕對路徑。
- `d44e166` 修正 Monaco 複製／貼上受權限策略與缺少 product service 影響而失效，僅對自家主視窗開放必要剪貼簿能力。
- `281e019` 重做應用程式退出流程：等待 PTY／LSP／watcher teardown，必要時顯示執行中程序確認，避免關窗後殘留整棵程序樹。

### 2026-07-07｜Windows 通知、共用剪貼簿與圖片預覽

- `280fc72` 設定 Windows AUMID 並保留通知物件引用，改善點擊通知回到 Polydesk 的可靠性。
- `1b01e21` Explorer 複製路徑與 SCM 複製雜湊／訊息統一改走 Electron clipboard IPC，修正瀏覽器剪貼簿權限被拒後靜默失效。
- `38bb38d` 為終端機右鍵貼上增加 300ms 防抖，避免裝置重複觸發或連點造成雙貼。
- `20c23fe` 新增 PNG、JPG、GIF、WebP、BMP、ICO、SVG 唯讀圖片預覽，提供符合視窗／實際大小切換與檔案資訊。

### 2026-07-06｜搜尋、文件預覽與 Git ref

- `6bf103a`、`d953b09` 修正多終端機拖曳雙向排序、拖曳來源、Escape 取消改名及 rail splitter 的動態 aria 數值。
- `a6ac067` 在 Git 線圖標示本地與遠端分支位置，形成接近 VS Code 的 ref 徽章體驗。
- `0818a91` 將打包後 ripgrep 路徑轉到 `app.asar.unpacked`，修正正式包搜尋永遠回空。
- `5c2cd69` 搜尋面板新增檔名群組，內容命中可直接跳行並反白片段。
- `c680aa8` 新增 DOCX／DOC 唯讀預覽：DOCX 保留語意 HTML 與圖片、舊 DOC 顯示純文字，並可交給系統程式開啟。
- `56f4c0e` 編輯器分頁依工作區隔離，切換工作區不再混雜，切回時還原最後聚焦分頁。
- `c348a94`、`4dfd0ca` 更新 Git 與工作區 E2E selector／前提，讓測試符合新版 UI 並維持決定性。

### 2026-07-03｜終端體驗、工作區切換與 SCM 回饋

- `12b876d` 修正終端機 keycap 項目編號顯示成數字加空框。
- `35e2c84` 修正點擊工作區列的 Claude／Codex 徽章區無法切換工作區。
- `471ebac` 為快速工作區切換加入載入防抖與 stale 取消，避免畫面卡住或舊請求覆蓋新狀態。
- `2da6306` 更新 Git commit 操作測試中已過時的 active branch selector。
- `bc199f5` 為淺色主題調整 ANSI 色盤，並打包四款開源等寬字型。
- `96034a2` 醒目顯示未推 commit，並在狀態列常駐目前分支。
- `8571261` 未納管 worktree 的「切換到此」改為就地詢問加入，不再中斷流程。
- `7e75502` 提升淺色／暖色主題彈窗標題的辨識度。
- `2e7a772` 桌面通知可點擊回到 Polydesk 並切換到對應工作區。
- `12d6780` 多終端機支援拖曳排序、顯示／隱藏而不關閉，以及自訂名稱。
- `961fb45` SCM 讀取與載入期間加入動態回饋。
- `73bd2c1` 為工作區欄 splitter 補上 `aria-valuenow`、`aria-valuemin` 與 `aria-valuemax`。

### 2026-07-02｜品牌、Git Worktree 第二迭代與終端相容性

- `b3537bc` 全站換成 Polydesk 疊層星芒品牌圖示。
- `be100df` 讓終端機底色填滿 pane，已開啟終端機也會即時跟隨主題。
- `474e372` 為 Explorer 刪除單元測試注入資源回收桶 stub，修正刪除行為改版後長期失敗的測試。
- `65b1ce7` 凍結 Git Worktree 第二迭代規格與分波設計。
- `450e89a` 建立 worktree typed IPC、GitService 操作、路徑／信任硬化及持久化 schema v2。
- `812195f` 完成建立 worktree 流程：工作區「＋」入口、對話框、自動納管開啟及 rail 識別。
- `18414ff` 新增 SCM worktree 分頁，提供列表、切換、移除、dirty 兩段確認與 prune。
- `486c3cb` 在分支分頁加入「在新 worktree 開啟」，checkout 衝突時可跳轉到既有 worktree。
- `6f008da` 建立 worktree 效能 budget 與整合回歸；`80066d6` 再依 ship 審查強化錯誤處理及量測穩健性。
- `98ca03d` 終端機支援 `Ctrl+V`、右鍵貼上與 `Ctrl+Shift+C` 複製。
- `84a9bf6` 在安全護欄下開放 OSC 52 寫入剪貼簿，使 Claude Code 選取複製可用。
- `e03e052` 改善 AI 狀態掃描的 fail-open、背景化與掛載快照，減少狀態燈閃爍或延遲。
- `6adbf19` 視窗座標離開所有螢幕工作區時自動重設置中，處理拔除外接螢幕與解析度變更。
- `18db9ff` 修正 emoji 亂碼並加入終端機字型設定。

## v0.1.0（2026-07-01）

首個可用版：多工作區、終端機多開（真 PTY）、檔案總管／Monaco 編輯器、Git 原始碼控制、三主題與 portable 打包。tag `v0.1.0` 位於 `e6b803b`。

### 2026-07-01｜總覽、檔案操作、預覽與 portable 基線

- `cc88c2d` 集中修正 AI 監控與 Explorer dogfood 問題。
- `297532f`、`bbdca44` 將 Claude 與 Codex 狀態改為真實 process 偵測，降低殘留狀態誤判。
- `bb9e66f` 外部改檔不再立即彈窗打斷編輯，改到關檔時提醒處理衝突。
- `4a72511` 建立 Claude／Codex 用量讀取後端；`efa56f0` 加入總覽面板；`6eb7a91` 再補自動更新、工作區欄顯隱與版面重設。
- `fff519a` 三套主題統一採用 Geist 字型。
- `02ae997`、`57e4df7` 支援從系統剪貼簿把外部檔案貼入 Explorer，並補上焦點不在可編輯元素時的 paste catcher。
- `ba28ed3` 依審查修正 statusline 編碼／BOM、symlink 刪除與 SCM discard 回收桶行為。
- `b1afe72` 將總覽面板改為全視窗遮罩並置中。
- `691bf3e` 新增 XLSX／XLS 表格預覽，包含欄標、列號及多工作表切換。
- `41fbb8d` Explorer 刪除改移到資源回收桶，與 SCM 行為一致且可救回。
- `a88de49` 修正 danger 按鈕 hover 在淺色背景下看不清楚。
- `be3fa2e` 補記 typecheck 與 Playwright 驗證嘗試，讓後續能追蹤測試結果與失敗脈絡。
- `50125c9` 加入 MIT License、README 與 portable 打包設定；`e6b803b` 修正 native 模組重編與 asarUnpack，並在此 commit 標記 `v0.1.0`。

### 2026-06-30｜終端編碼、版面操作、Git 認證與 Codex 監控

- `16aeb28` 修正終端機亂碼、banner 洪水與 PowerShell 中文顯示。
- `d005ec9` 加入面板拖曳換位、標頭整併、真隱藏及可拖曳工作區寬度。
- `f192b77` 修正 Git pull／push 認證，並加入 AI 智慧產生 commit message。
- `a3db22a` 修正剛開啟 Claude 就誤顯示執行中，以及 working 殘留的時效問題。
- `0dd1eb4` 以 rollout JSONL 零侵入監控 Codex 狀態。
- `dea41f8` 新增 VS Code 風格 Explorer 右鍵新增、改名、刪除與剪貼操作。

### 2026-06-29｜第一次 dogfood、效能、安全與互動深化

- `5208903` 版面工具列新增「編輯器」顯示／隱藏。
- `dda9413` Git 歷史加入 swimlane commit 線圖；`ddfbe8c` 修正跨列斷線、拓撲排序及 dirty tree 切分支流程。
- `a4ffbc3` 建立 VS Code 風格無框標題列、自訂選單與視窗控制。
- `d791a2c` 建立冷啟動、工作區切換、開檔、按鍵延遲與 10 工作區背景 CPU 的效能量測基線。
- `65a3f42` 完成 a11y pass：axe 無 serious／critical 違規，並以純鍵盤完成新增工作區、開檔及存檔。
- `ce9596b` 完成 spawn env 白名單、Git 執行環境、renderer CSP／權限及終端 escape 安全硬化。
- `a125dbb` 依 ship 對抗式審查修正一項高風險與多項中低風險問題。
- `da63e65` 點擊 SCM 變更檔會在編輯器區開 diff 分頁，並提供 worktree checkout 衝突提示。
- `6161db6` Claude 狀態加入文字標籤、待接手桌面通知與總覽計數。
- `011f2da` Git commit 線圖加入完整 hover 資訊及複製、查看變更、checkout、建立分支等右鍵操作。
- `f11d2e0` 擴充 SCM：hover 可滑入、commit 可展開檔案、untracked diff 與變更右鍵操作。
- `0b49a49`、`21fb781` 修正版面重設與顯隱造成面板 dispose、終端內容遺失或破版。
- `888807e` 修正 Claude 關閉後狀態仍卡在執行中。
- `cec83ce`、`b9ba8d0`、`cadc4be` 分三階段導入 Claude hooks 狀態接線與可靠路徑解析。
- `60ff8d1` 終端機從單純 tab 切換升級為可並排／上下分割及拖曳調整。
- `49c3a55` 手動 stash 改為包含 untracked 檔案。
- `bb9478e` 整併終端機標頭，面板真隱藏時序列化保留 scrollback。

### 2026-06-28｜從零建立 Polydesk

- `adcc4b8` 建立 Electron／React／TypeScript 三進程骨架、typed IPC、StateStore、單一實例、安全基線與效能埋點。
- `30668eb` 完成 dockview 版面、深／淺／暖三主題、設定匯出入、dialog host 與 workspace 模型。
- `47a2d23` 一次打通五項核心 IDE 能力：工作區、Explorer、ConPTY 終端機、Monaco 編輯器與 Git GUI。
- `24cfc58` 提供 PTY 子程序探測接縫；`6f78312` 擴充 LSP request／sync／diagnostics IPC。
- `85b136b` 完成六語言 LSP bridge、ripgrep 全域搜尋、Claude 狀態監控及 dock 版面持久化。
- `62a8a37` 修正 SearchService ESM 非同步重構後的測試收斂問題。
- `c7a5065` 建立 electron-builder 打包、自動更新、原生模組 asarUnpack 驗證與 updater IPC。

## 維護紀錄的原則

後續每次功能交付，應從實際 Git commit 補入本文件，至少包含日期、使用者旅程、問題原因、主要影響範圍與可追溯短雜湊。純 journal／ledger 對帳、無產品行為變化的測試資料整理，可留在 Git 歷史與 `specs/tasks.md`，不重複包裝成使用者更新。
