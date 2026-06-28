import { useEffect, useState } from 'react';
import { ipc } from './ipc/client';
import type { PersistState } from '../shared/types';

// P-1 最小殼：透過 preload IPC 讀 AppState 顯示 placeholder。
// 真 UI（dockview / 工作區列表 / 編輯器…）由後續 feature task 疊上。
export function App(): React.JSX.Element {
  const [state, setState] = useState<PersistState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc.store
      .getState()
      .then((s) => {
        setState(s);
        document.documentElement.setAttribute('data-theme', s.theme);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ margin: 0 }}>Polydesk</h1>
      <p style={{ color: '#888' }}>多工作區開發終端機 — 骨架就緒</p>

      {error && <p style={{ color: '#dc2626' }}>無法載入狀態：{error}</p>}

      {!error && !state && <p>載入中…</p>}

      {state && (
        <ul>
          <li>主題 theme：{state.theme}</li>
          <li>工作區數 workspaces：{state.workspaces.length}</li>
          <li>schemaVersion：{state.schemaVersion}</li>
        </ul>
      )}

      <p style={{ color: '#888', fontSize: 13 }}>
        IPC 契約、狀態持久化、單一實例、安全基線、perf 埋點已就位；後續功能由各 feature task 接上。
      </p>
    </main>
  );
}
