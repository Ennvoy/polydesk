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
