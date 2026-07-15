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
