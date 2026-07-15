// 關於 Polydesk（PE-3 版本可視化）：版本號＋釋出日期＋近版更新重點。
// 版本資料唯一來源 = shared/releaseNotes（單測釘死與 package.json 同步），不打 IPC、不讀檔。
import React from 'react';
import { RELEASE_NOTES, APP_VERSION } from '../../../shared/releaseNotes';

const SHOW_VERSIONS = 3; // 只列近幾版重點，完整歷史在 CHANGELOG.md（更新旅程）

export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div style={{ width: 460, maxWidth: '80vw', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true" style={{ color: 'var(--accent)' }}>
          {/* Polydesk 疊層星芒（與標題列同款，隨 --accent 換色） */}
          <polygon points="50,20 22,72 78,72" fill="currentColor" opacity="0.95" />
          <polygon points="24,28 80,44 44,80" fill="currentColor" opacity="0.6" />
          <polygon points="76,30 56,80 20,50" fill="currentColor" opacity="0.45" />
        </svg>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Polydesk</h2>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }} aria-label={`目前版本 v${APP_VERSION}`}>
            v{APP_VERSION}（{RELEASE_NOTES[0].date}）
          </div>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-2)' }}>
        多工作區開發終端機 — 把多個專案的終端機、編輯器、Git 與 AI 執行狀態收進同一個桌面工具。
      </p>

      <div
        style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        aria-label="近期版本更新重點"
      >
        {RELEASE_NOTES.slice(0, SHOW_VERSIONS).map((n) => (
          <section key={n.version}>
            <h3 style={{ margin: '0 0 4px', fontSize: 'var(--text-sm)' }}>
              v{n.version} <span style={{ color: 'var(--muted)', fontWeight: 'normal' }}>（{n.date}）</span>
            </h3>
            <ul style={{ margin: 0, paddingLeft: '1.4em', fontSize: 'var(--text-sm)', color: 'var(--fg-2)' }}>
              {n.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>完整歷史見 CHANGELOG.md（更新旅程）</span>
        <button className="pd-btn pd-btn-primary" onClick={onClose} aria-label="關閉關於視窗">
          關閉
        </button>
      </div>
    </div>
  );
}
