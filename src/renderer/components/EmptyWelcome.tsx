// 空工作區歡迎頁（REQ-WS-007）：列表為空時顯示，提供大「新增工作區」CTA。
// 純表現元件：新增流程由 WorkspaceRail 透過 onAdd 傳入（與 rail 標頭的新增鈕共用同一流程）。

import React from 'react';

export function EmptyWelcome({ onAdd, onClone }: { onAdd: () => void; onClone: () => void }): React.JSX.Element {
  return (
    <div
      role="region"
      aria-label="尚無工作區"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-8) var(--space-5)',
      }}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--meta)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 5h6l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
        <path d="M12 11v6M9 14h6" />
      </svg>
      <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)', color: 'var(--fg)' }}>
        還沒有工作區
      </h2>
      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-2)', lineHeight: 1.6, maxWidth: 200 }}>
        新增一個專案資料夾，開始多工作區的終端機、編輯與 Claude 體驗。
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="pd-btn pd-btn-primary" onClick={onAdd} aria-label="新增工作區" style={{ padding: '8px 16px' }}>
          新增工作區
        </button>
        <button className="pd-btn" onClick={onClone} aria-label="Clone Git Repository" style={{ padding: '8px 16px' }}>
          Clone Git Repository
        </button>
      </div>
    </div>
  );
}
