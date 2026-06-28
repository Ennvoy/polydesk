// 設定面板（REQ-THEME-001、REQ-PERSIST-005、design S12）：三主題即時切換 + 設定匯出/匯入。
// 匯出走 Blob 下載、匯入走 file input → ipc.store.import（不需原生對話框，sandbox 友善）。

import React, { useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import { appStore } from '../../state/appStore';
import { ipc } from '../../ipc/client';
import type { ThemeId } from '../../../shared/types';

const THEMES: { id: ThemeId; label: string; desc: string }[] = [
  { id: 'dark', label: '深色', desc: 'near-black 畫布 · 工程感' },
  { id: 'light', label: '淺色', desc: '純白畫布 · Vercel 藍' },
  { id: 'warm', label: '暖色', desc: 'parchment · terracotta' },
];

export function SettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onExport = async (): Promise<void> => {
    const { json } = await ipc.store.export();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'polydesk-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    setMsg('已匯出 polydesk-settings.json');
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = await ipc.store.import({ json: text });
    if ('ok' in res) {
      await appStore.loadWorkspaces();
      const s = await ipc.store.getState();
      setTheme(s.theme);
      setMsg('已匯入設定（工作區/主題已還原）');
    } else {
      setMsg(`匯入失敗：${res.error}`);
    }
    e.target.value = '';
  };

  return (
    <div style={{ minWidth: 420, maxWidth: 520 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>設定</h2>
        <button className="pd-btn" aria-label="關閉設定" onClick={onClose}>關閉</button>
      </div>

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>主題</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`pd-theme-card${theme === t.id ? ' is-active' : ''}`}
              aria-pressed={theme === t.id}
              aria-label={`套用${t.label}主題`}
              onClick={() => setTheme(t.id)}
            >
              <span style={{ fontWeight: 600 }}>{t.label}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--meta)' }}>{t.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 8 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>設定可攜</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="pd-btn" onClick={() => void onExport()} aria-label="匯出設定">匯出設定</button>
          <button className="pd-btn" onClick={() => fileRef.current?.click()} aria-label="匯入設定">匯入設定</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => void onImportFile(e)} />
        </div>
      </section>

      {msg && <p style={{ color: 'var(--fg-2)', fontSize: 'var(--text-xs)', marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
