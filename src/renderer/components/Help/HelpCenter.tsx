import React, { useMemo, useState } from 'react';
import { dialog } from '../Dialogs/host';
import { appStore } from '../../state/appStore';
import { railBus } from '../../state/railBus';
import { setLayoutPanelVisible } from '../../layout/DockLayout';
import './help.css';

type HelpAction = 'explorer' | 'search' | 'scm' | 'editor' | 'terminal';

interface HelpArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
  steps: string[];
  states?: { label: string; detail: string }[];
  tips?: string[];
  action?: HelpAction;
  actionLabel?: string;
}

const ARTICLES: HelpArticle[] = [
  {
    id: 'workspace', category: '開始使用', title: '新增與切換工作區',
    summary: '把資料夾、Git repository 或 worktree 納入 Polydesk，並在多個專案間切換。',
    steps: ['在左側「工作區」按＋。', '選擇新增資料夾、Clone repository，或從分支建立 worktree。', '確認信任範圍後，點工作區名稱切換。'],
    states: [
      { label: '資料夾遺失', detail: '工作區會灰化且不可開啟；確認磁碟或網路路徑後重新加入。' },
      { label: 'AI 狀態徽章', detail: '綠色代表執行中、琥珀代表等待接手、灰色代表未啟動。' },
    ],
  },
  {
    id: 'workspace-manage', category: '開始使用', title: '重新命名、排序與移除',
    summary: '整理工作區列表，不會在未確認時刪除實體專案資料夾。',
    steps: ['雙擊名稱或按鉛筆重新命名。', '拖曳工作區調整順序。', '按×移除；只有勾選瀏覽資料並二次確認時才永久清除該工作區的登入態與快取。'],
    states: [{ label: '有執行中終端機', detail: '移除前會再次確認，避免誤殺建置、伺服器或 AI 工作。' }],
  },
  {
    id: 'explorer', category: '檔案與搜尋', title: '檔案總管',
    summary: '建立、開啟、重新命名、複製、貼上與刪除工作區內的檔案。',
    steps: ['按工作區上方的資料夾圖示。', '展開資料夾並點檔案，在編輯器開啟。', '右鍵使用新增、重新命名、複製、貼上、刪除或在檔案總管顯示。'],
    states: [
      { label: '外部修改', detail: '乾淨分頁會自動更新；未儲存分頁會標記衝突，存檔前要求選擇。' },
      { label: '無法預覽', detail: '不支援或過大的檔案會顯示原因，可改用系統應用程式開啟。' },
    ],
    action: 'explorer', actionLabel: '前往檔案總管',
  },
  {
    id: 'search', category: '檔案與搜尋', title: '全域搜尋與取代',
    summary: '在目前工作區搜尋文字，支援大小寫、規則運算式與批次取代。',
    steps: ['按放大鏡圖示。', '輸入關鍵字並依需要開啟大小寫或規則運算式。', '點結果開啟檔案；執行取代前先檢查影響範圍。'],
    states: [
      { label: '結果截斷', detail: '結果超過安全上限時會明確提示；縮小資料夾或關鍵字範圍再搜尋。' },
      { label: '搜尋取消', detail: '切換查詢會取消前一次工作，舊結果不會混入新清單。' },
    ],
    action: 'search', actionLabel: '前往搜尋',
  },
  {
    id: 'scm-changes', category: '原始碼控制', title: '檢視、暫存與提交變更',
    summary: '管理 Git 變更、diff、暫存區、提交、推送與拉取。',
    steps: ['按分支圖示；角標是未提交變更數。', '點檔案看 diff，使用＋暫存或取消暫存。', '輸入提交訊息後提交，再依需要推送或拉取。'],
    states: [
      { label: '不是 Git repository', detail: '會提供初始化入口；確認後才建立 .git。' },
      { label: '衝突', detail: '先在編輯器處理衝突標記並重新暫存，不會自動覆蓋。' },
      { label: '推送／拉取失敗', detail: '依認證、網路、遠端拒絕或分支分歧顯示可行下一步。' },
    ],
    action: 'scm', actionLabel: '前往原始碼控制',
  },
  {
    id: 'scm-branches', category: '原始碼控制', title: '分支、stash 與 worktree',
    summary: '切換與建立分支、保存暫存工作，或用獨立 worktree 同時處理多條分支。',
    steps: ['在分支區展開本地或遠端群組。', '使用⋯或右鍵開啟共用操作選單。', '刪除前閱讀確認內容；本地未合併、目前分支及 worktree 使用中的分支會被阻擋。'],
    states: [{ label: '遠端快照可能過期', detail: '先 fetch 更新；受保護分支或認證失敗時遠端會拒絕刪除。' }],
    action: 'scm', actionLabel: '前往分支管理',
  },
  {
    id: 'scm-ai-commit', category: '原始碼控制', title: 'AI 產生 commit 訊息',
    summary: '讓 Claude、Codex 或 Agy 依已暫存變更草擬 commit 訊息，再由你確認與提交。',
    steps: ['先把要納入本次提交的檔案暫存。', '在 commit 訊息區選擇 Claude、Codex 或 Agy，按「產生」。', '檢查並依需要修改回填的訊息，再按「提交」；產生功能不會自動 commit。'],
    states: [
      { label: '沒有已暫存變更', detail: '先暫存至少一個檔案；未暫存內容不會送去產生訊息。' },
      { label: '產生失敗', detail: '確認選定的 AI CLI 已安裝且可執行，再重試或自行輸入 commit 訊息。' },
    ],
    tips: ['AI 產生的內容只是草稿；提交前仍應確認訊息和實際 staged diff 一致。'],
    action: 'scm', actionLabel: '前往產生 commit 訊息',
  },
  {
    id: 'editor', category: '編輯器', title: '編輯、預覽與分頁',
    summary: '使用 Monaco 編輯文字，並預覽圖片、Word 與試算表。',
    steps: ['從檔案總管、搜尋或 SCM 點檔案。', '使用分頁切換；右鍵可關閉、關閉其他或關閉全部。', '未儲存內容在關閉前會要求儲存、捨棄或取消。'],
    states: [
      { label: '外部衝突', detail: '磁碟內容和未儲存文字同時變更時不會自動覆蓋，需由使用者選擇。' },
      { label: '唯讀預覽', detail: '圖片與文件預覽不可直接修改；可用外部應用程式開啟。' },
    ],
    action: 'editor', actionLabel: '顯示編輯器',
  },
  {
    id: 'terminal', category: '終端機與 AI', title: '終端機與多分割',
    summary: '在工作區 ConPTY 終端機執行 shell、建置、伺服器與互動工具。',
    steps: ['在終端機工具列選擇 PowerShell、CMD、pwsh、Git Bash 或 WSL。', '按＋新增；使用並排或上下切換分割方向。', '關閉執行中程序前閱讀確認，避免遺失工作。'],
    states: [
      { label: '找不到 shell', detail: '設定會指出缺少的 shell；安裝後重新開啟 Polydesk。' },
      { label: '程序結束', detail: '保留輸出並提供重新啟動，不會假裝仍在執行。' },
    ],
    action: 'terminal', actionLabel: '顯示終端機',
  },
  {
    id: 'ai-launch', category: '終端機與 AI', title: 'Claude bypass、Codex 與 Agy',
    summary: '用快捷按鈕建立獨立終端機，待尺寸穩定後啟動對應 AI CLI。',
    steps: ['先選擇可信任的工作區。', '按 Claude bypass、Codex 或 Agy。', '每個按鈕建立獨立終端機；可同時保留多個工作階段。'],
    states: [
      { label: 'Claude bypass', detail: '會略過權限確認，只能用在完全信任的工作區。' },
      { label: '等待確認', detail: '工作區徽章與總覽顯示待接手，不會自動替使用者核准。' },
    ],
    action: 'terminal', actionLabel: '前往 AI 快捷啟動',
  },
  {
    id: 'overview-ai-usage', category: '終端機與 AI', title: '總覽與 AI 用量',
    summary: '集中查看 Claude、Codex 的服務用量，以及每個工作區的 Claude、Codex、Agy 執行狀態。',
    steps: ['按工作台上方的「總覽」。', '在服務用量查看帳號實際回傳的短期與每週視窗；Codex 有回傳時也會顯示方案。', '在工作區 AI 狀態查看各工具是未啟動、執行中、待確認或已停止。'],
    states: [
      { label: '尚無用量資料', detail: '代表服務目前沒有回傳可顯示資料；Claude 需由 Polydesk 注入 statusline 並執行過一次。' },
      { label: 'Agy 沒有用量卡', detail: 'Agy CLI 目前不提供用量資料，但工作區狀態仍會顯示。' },
      { label: '資料更新', detail: '總覽開啟時會載入，之後每 20 秒更新；讀取失敗時保留可確認的既有畫面，不會捏造數值。' },
    ],
  },
  {
    id: 'layout', category: '版面與設定', title: '顯示、隱藏與重設版面',
    summary: '控制工作區列、側欄、編輯器與終端機，並保存寬度和停靠位置。',
    steps: ['使用工作台上方按鈕或「檢視」選單切換區域。', '拖曳工作區分隔線與 dock 分隔線調整尺寸。', '版面異常時使用「重設版面」；開啟的編輯器與終端機會盡量保留。'],
    states: [{ label: '按標頭×', detail: '編輯器與終端機會原地隱藏，重新顯示時維持側欄尺寸與工作狀態。' }],
  },
  {
    id: 'settings', category: '版面與設定', title: '主題、終端字型與設定可攜',
    summary: '切換深色、淺色、暖色主題，調整終端字型，並匯出或匯入設定。',
    steps: ['從工作區工具列齒輪或「檔案 → 設定」開啟。', '主題與終端字型會即時套用。', '匯入前確認 JSON 來源；驗證失敗不會破壞目前設定。'],
    states: [{ label: '設定檔損毀', detail: '啟動時會備份壞檔並使用安全預設，不讓程式無法開啟。' }],
  },
  {
    id: 'safety', category: '問題排除', title: '信任、確認與安全限制',
    summary: '理解為什麼某些操作被阻擋，以及如何在不繞過保護的情況下繼續。',
    steps: ['只加入你理解且信任的工作區。', '刪除、捨棄、強制停止及 bypass 前閱讀影響範圍。', '外部連結只交給系統瀏覽器；終端機連結不允許啟動可執行檔或腳本。'],
    states: [
      { label: '操作停用', detail: '將游標移到停用項目查看具名原因，再處理目前分支、worktree 或必要前置。' },
      { label: '等待確認', detail: '表示系統刻意停下等待你拍板，不是當機。' },
    ],
  },
];

const CATEGORIES = [...new Set(ARTICLES.map((article) => article.category))];

function performAction(action: HelpAction): void {
  if (action === 'explorer' || action === 'search' || action === 'scm') {
    railBus.setVisible(true);
    setLayoutPanelVisible('sidebar', true);
    appStore.setActiveView(action);
  } else {
    setLayoutPanelVisible(action, true);
  }
}

export function HelpCenter({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const normalized = query.trim().toLocaleLowerCase('zh-TW');
  const matches = useMemo(() => {
    const pool = normalized ? ARTICLES : ARTICLES.filter((article) => article.category === category);
    if (!normalized) return pool;
    return pool.filter((article) => JSON.stringify(article).toLocaleLowerCase('zh-TW').includes(normalized));
  }, [category, normalized]);

  return (
    <div className="pd-help-center">
      <header className="pd-help-header">
        <div>
          <p className="pd-help-eyebrow">POLYDESK GUIDE</p>
          <h2>使用說明</h2>
        </div>
        <div className="pd-help-header-actions">
          <label className="pd-help-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋功能、狀態或問題" aria-label="搜尋使用說明" />
          </label>
          <button className="pd-btn" onClick={onClose} aria-label="關閉使用說明">關閉</button>
        </div>
      </header>
      <div className="pd-help-body">
        <aside className="pd-help-nav" aria-label="使用說明分類">
          {CATEGORIES.map((item) => (
            <button key={item} className={category === item && !normalized ? 'is-active' : ''} onClick={() => { setCategory(item); setQuery(''); }}>
              {item}
              <span>{ARTICLES.filter((article) => article.category === item).length}</span>
            </button>
          ))}
        </aside>
        <main className="pd-help-content">
          <div className="pd-help-section-title">
            <span>{normalized ? `搜尋「${query.trim()}」` : category}</span>
            <small>{matches.length} 篇</small>
          </div>
          {matches.length === 0 ? (
            <div className="pd-help-empty">找不到相符內容，試著改用功能名稱或畫面上的狀態文字。</div>
          ) : matches.map((article) => (
            <article key={article.id} className="pd-help-article" id={`help-${article.id}`}>
              <div className="pd-help-article-heading">
                <div>
                  <span>{article.category}</span>
                  <h3>{article.title}</h3>
                  <p>{article.summary}</p>
                </div>
                {article.action ? (
                  <button className="pd-btn pd-help-go" onClick={() => { onClose(); performAction(article.action!); }}>
                    {article.actionLabel ?? '直接前往'}
                  </button>
                ) : null}
              </div>
              <ol>{article.steps.map((step) => <li key={step}>{step}</li>)}</ol>
              {article.states?.length ? (
                <div className="pd-help-states">
                  {article.states.map((state) => (
                    <div key={state.label}><strong>{state.label}</strong><span>{state.detail}</span></div>
                  ))}
                </div>
              ) : null}
              {article.tips?.map((tip) => <p key={tip} className="pd-help-tip">{tip}</p>)}
            </article>
          ))}
        </main>
      </div>
    </div>
  );
}

export function openHelpCenter(): void {
  void dialog.open((close) => <HelpCenter onClose={() => close()} />);
}
