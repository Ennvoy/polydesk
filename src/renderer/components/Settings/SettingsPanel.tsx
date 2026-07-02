// 設定面板（REQ-THEME-001、REQ-PERSIST-005、design S12）：三主題即時切換 + 設定匯出/匯入。
// 匯出走 Blob 下載、匯入走 file input → ipc.store.import（不需原生對話框，sandbox 友善）。

import React, { useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import { useTerminalFont } from '../../theme/TerminalFontProvider';
import { clampTerminalFontSize } from '../Terminal/secureOptions';
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '../../../shared/constants';
import { appStore } from '../../state/appStore';
import { ipc } from '../../ipc/client';
import type { ThemeId } from '../../../shared/types';

const THEMES: { id: ThemeId; label: string; desc: string }[] = [
  { id: 'dark', label: '深色', desc: 'near-black 畫布 · 工程感' },
  { id: 'light', label: '淺色', desc: '純白畫布 · Vercel 藍' },
  { id: 'warm', label: '暖色', desc: 'parchment · terracotta' },
];

/** 內建三選（機器都有裝）；其他字型走自訂輸入。 */
const TERMINAL_FONTS: { family: string; desc: string }[] = [
  { family: 'Consolas', desc: 'VS Code 同款' },
  { family: 'Cascadia Code', desc: '有連字' },
  { family: 'Cascadia Mono', desc: 'Windows Terminal 風' },
];

export function SettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const { font, setFont } = useTerminalFont();
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 字級草稿：輸入中不即時 clamp（打「1」想輸入 14 不被跳成 8），blur / Enter 才收斂套用。
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);
  const [customFamily, setCustomFamily] = useState('');

  const commitSize = (): void => {
    if (sizeDraft === null) return;
    const n = Number(sizeDraft);
    setSizeDraft(null);
    if (Number.isFinite(n)) setFont({ family: font.family, size: clampTerminalFontSize(n) });
  };

  const applyCustomFamily = (): void => {
    const f = customFamily.replace(/["']/g, '').trim();
    if (!f) return;
    setFont({ family: f, size: font.size });
    setCustomFamily('');
  };

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

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', color: 'var(--muted)', fontWeight: 600 }}>終端機字型</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {TERMINAL_FONTS.map((f) => (
            <button
              key={f.family}
              className={`pd-theme-card${font.family === f.family ? ' is-active' : ''}`}
              aria-pressed={font.family === f.family}
              aria-label={`終端機字型改用 ${f.family}`}
              onClick={() => setFont({ family: f.family, size: font.size })}
            >
              {/* 卡片標籤直接用該字型渲染＝所見即所得的迷你預覽 */}
              <span style={{ fontWeight: 600, fontFamily: `"${f.family}", monospace` }}>{f.family}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--meta)' }}>{f.desc}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input
            className="pd-input"
            placeholder="自訂字型名（需已安裝）"
            aria-label="自訂終端機字型名稱"
            value={customFamily}
            onChange={(e) => setCustomFamily(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyCustomFamily(); }}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button className="pd-btn" onClick={applyCustomFamily} aria-label="套用自訂字型">套用</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
            字級
            <input
              className="pd-input"
              type="number"
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              aria-label="終端機字級（px）"
              value={sizeDraft ?? String(font.size)}
              onChange={(e) => setSizeDraft(e.target.value)}
              onBlur={commitSize}
              onKeyDown={(e) => { if (e.key === 'Enter') commitSize(); }}
              style={{ width: 64 }}
            />
            px
          </label>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)', color: 'var(--meta)' }}>
          目前：{font.family} {font.size}px · 改動即時套用到開啟中的終端機
        </p>
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
