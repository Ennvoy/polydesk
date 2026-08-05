// 版本釋出紀錄（單一真相）：頂端項目＝目前版本。
// 同步鐵則：bump 版本時 SHALL 同步改 package.json version 與本檔頂端項目——
// releaseNotes.test.ts 以確定性單測擋「兩處不同步」（忘了哪邊都會紅燈）。
// 完整逐 commit 歷史在 CHANGELOG.md；此處只放「關於」視窗要顯示的使用者可感知重點。

export interface ReleaseNote {
  /** semver 版本號（不含前綴 v）。 */
  version: string;
  /** 釋出日期（YYYY-MM-DD）。 */
  date: string;
  /** 使用者可感知的更新重點（3~6 條）。 */
  highlights: string[];
}

/** 由新到舊排列；[0] 即目前版本。 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.20.0',
    date: '2026-08-05',
    highlights: [
      'Claude 面板新增對話軸：左側導覽軌改以對話訊息為節點，長的是你的提問、短的是 Claude 回覆',
      '滑過節點可看該則摘要，點擊會開啟 Claude 的對話檢視並跳到該則提問',
      '修正 Claude 等自繪畫面的 TUI 完全看不到導覽軌（它們沒有終端機捲動紀錄可掃）',
      '離開 TUI 回到一般 shell 時自動切回原本的逐行導覽軌',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-08-04',
    highlights: [
      '修正舊版或手動加入的 worktree 按下兩種移除選項都沒有反應',
      '即使工作區缺少 worktree metadata，也會以 Git 真實登記安全解析主工作樹與待刪路徑',
      '移除失敗時會保留可讀錯誤，不再被重新整理立即清掉',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-07-31',
    highlights: [
      '終端機新增內容導覽軌，可點擊每個非空邏輯行快速跳回先前輸出',
      '支援 Alt+上／下逐節點移動、目前位置標示、鍵盤焦點提示與減少動態效果設定',
      '背景終端改採低頻批次輸出、共用單一 renderer 分流；鍵盤輸入後的回應則優先以 4ms flush',
      '四工作區真 Electron 串流壓測達 frame p95 19.7ms、renderer CPU 3.6%，四個終端皆持續接收輸出',
      '原始碼控制共用短時 Git 快照、停止因工作檔變動重讀歷史，並將大量變更清單改為每批 200 項',
      'Git 線圖在 fetch 後會顯示尚未 pull 的遠端分支與同事提交，不會自動 merge 或改動工作樹',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-07-27',
    highlights: [
      '修正某些第三方軟體複製的圖片仍無法貼入檔案總管',
      '即使剪貼簿只公告無磁碟路徑、通用 MIME 的虛擬檔案，仍會由主程序嘗試讀取 bitmap',
      '圖片貼上不依賴系統 PATH，實體檔案、標準 bitmap 與虛擬圖片檔皆有獨立回歸驗證',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-07-27',
    highlights: [
      '檔案總管現在可直接貼上截圖工具、瀏覽器或通訊軟體複製的圖片',
      '沒有磁碟路徑的剪貼簿 bitmap 會安全轉成貼上圖片.png，重名時自動改名、不覆蓋既有檔案',
      '圖片資料只在主程序內讀取與落檔，保留工作區路徑沙箱並限制為 20MB',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-07-27',
    highlights: [
      '修正 PATH 被其他軟體重排後，工作區的 Claude、Codex、Agy 執行狀態標籤全部消失',
      'AI 程序掃描改用 Windows 系統工具的絕對路徑，不再依賴 PATH 尋找 PowerShell 或 WMIC',
      '終端機啟動與 AI 狀態監控現在套用一致的 PATH 相容策略',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-07-27',
    highlights: [
      '修正 Claude Code 顯示的 Read(...) 檔案路徑按住 Ctrl 點擊沒有反應',
      '支援 Read(path · lines 1-60) 格式，開檔時會直接跳到指定範圍的起始行',
      '括號內 Windows 絕對路徑與含空白路徑只會標示真正檔名，不會把工具名稱或行數後綴帶入',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-07-24',
    highlights: [
      '修正安裝 Sunlike365 等軟體後 PATH 被重排，導致 PowerShell、CMD 或 WSL 終端機按下後無法開啟',
      'Windows 內建 shell 改用系統絕對路徑；PowerShell 7 與 Git Bash 也會完整檢查 PATH 最後一段',
      '終端機建立或重啟失敗時會顯示原因與錯誤代碼，不再只呈現按鈕沒有反應',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-07-24',
    highlights: [
      '終端機輸出的 HTTP／HTTPS 網址現在可按住 Ctrl 點擊，並交由 Windows 預設瀏覽器開啟',
      '中文、全形字或 emoji 出現在網址前方時，底線與實際可點位置仍會依 xterm 格位正確命中',
      '一般左鍵保留給選字與 TUI 操作；javascript、file、data 與含帳密網址仍會被拒絕',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-07-23',
    highlights: [
      'AI 或外部工具修改已開啟檔案後，乾淨的文字分頁與唯讀預覽會自動更新，不必先關閉再重開',
      'AI 一次修改大量檔案時會對帳目前工作區的已開分頁；未存檔內容不會被覆蓋，儲存或關閉時仍會提示衝突',
      '編輯器分頁右鍵新增「關閉、關閉其他、關閉全部」，批次操作只影響目前工作區並尊重未存檔取消',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-07-23',
    highlights: [
      '修正 worktree 工作區執行 Claude、Codex 或 Agy 時，工作區列沒有顯示對應狀態標籤',
      'worktree 的分支圖示與 AI 狀態徽章現在可同時顯示，不再互相取代',
      '主工作樹與各 worktree 仍依各自路徑獨立歸戶，執行狀態不會顯示到錯誤工作區',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-07-23',
    highlights: [
      '修正終端輸出前方含中文、全形字或 emoji 時，檔案連結底線與實際可點位置錯位，導致 Ctrl+點擊無法開啟',
      '連結範圍現在依 xterm 實際格位換算，工作區檔案與行欄定位可穩定命中',
      '收緊相對路徑判定，不再把 N/A、workflow/subagent、API/資料表等一般文字誤標成檔案連結',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-07-22',
    highlights: [
      '修正 Claude bypass 偶發首屏歡迎橫幅殘影：啟動命令改等終端尺寸「靜置穩定」後才送出',
      '尺寸確認後若版面收斂、字型載入或失敗補送又改了欄寬會重新計時，確保 TUI 首屏用最終尺寸繪製',
      '快捷啟動約慢 0.25 秒換取首屏穩定；手動終端機與後續版面調整行為不變',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-07-22',
    highlights: [
      '修正 Claude 等 TUI 在側欄、工作區列或最大化狀態切換後，偶發沿用舊欄寬而被右側裁切',
      '終端尺寸同步現在會核對 ConPTY 是否真的套用成功；失敗會自動重試，不再把 IPC 完成誤當成 resize 成功',
      'AI 快捷啟動只會在 xterm 與 ConPTY 的欄列完全一致後送出命令，避免歡迎畫面按錯誤寬度繪製',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-07-21',
    highlights: [
      '終端機工具列新增 Claude bypass、Codex、Agy 三個快捷按鈕，一鍵建立獨立終端機並啟動對應 AI CLI',
      '快捷終端機自動以工具名稱標示；啟動命令會等終端畫面完成掛載後送出，避免遺失 CLI 第一段輸出',
      'Claude 快捷模式會略過所有權限確認，介面以警示色與說明明確標示，僅應用於完全信任的工作區',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-07-20',
    highlights: [
      'GitHub 私有 Repository Clone：已登入 gh 時直接沿用 GitHub 帳號權限，不再只依賴 Git Credential Manager',
      '尚未登入時提供「使用瀏覽器登入 GitHub 並重試」，OAuth code 自動複製到剪貼簿，完成後接續 Clone',
      '認證仍由 GitHub CLI 與系統憑證庫保管；Polydesk 不讀取、不保存 Token，公開倉庫與 SSH 流程維持不變',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-15',
    highlights: [
      '未拉取數字提示：遠端有新 commit 時，同步列顯示「↓N 未拉取」、pull 鈕右上角數字角標（與未推送同款）',
      '事件驅動 fetch：⟳ 重新整理順便取回遠端狀態、切工作區自動取回（60 秒冷卻）；不背景輪詢、平常零觸網',
      '取回只更新遠端狀態：不動工作樹、不自動合併；離線／認證失敗以小字提示，不跳錯誤橫幅',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-15',
    highlights: [
      '發佈到 GitHub：無 remote 時一鍵以 gh CLI 建立 repository、設定 origin 並推送（Polydesk 不碰 token）',
      'push 智慧補救：新分支沒 upstream 自動 push -u；失敗依認證／網路／repo 不存在給人話引導',
      '版本可視化：「說明 → 關於」視窗、狀態列常駐版本號、CHANGELOG 版本分節',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-15',
    highlights: [
      'Git 工作流升級：Clone Repository、外部 commit/push 自動同步、線圖與歷史徽章強化',
      'AI 狀態整合：Claude/Codex/Agy 執行狀態徽章、狀態列總覽、AI 產生 commit 訊息引擎',
      '終端機強化：多終端機選取複製、字型設定、emoji 亂碼根治、輸出跟捲自癒',
      '編輯器：docx/doc 唯讀預覽、diff 分頁、外部變更衝突保護',
      '版面與穩定性：關窗保存版面、編輯器叫回鏈硬化、拖放匯入檔案、Windows 通知',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-01',
    highlights: [
      '首發：多工作區管理、終端機多開（真 PTY）、檔案總管與 Monaco 編輯器',
      'Git 原始碼控制：status／stage／commit／push／stash／branch／log／diff',
      '三主題（深／淺／暖）、自訂無框標題列、portable 打包',
    ],
  },
];

/** 目前版本號（= RELEASE_NOTES[0].version；單測釘死與 package.json 一致）。 */
export const APP_VERSION = RELEASE_NOTES[0].version;
