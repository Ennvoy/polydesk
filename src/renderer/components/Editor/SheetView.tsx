// 試算表唯讀預覽（xlsx/xls/xlsm）：呼 fs:readSheet 取每工作表儲存格矩陣，Excel 風欄標(A/B/C)＋列號，
// 多工作表底部切換、表格可捲動。避免用文字編輯器硬開二進位 Excel 檔的亂碼。
import React, { useEffect, useState } from 'react';
import { ipc } from '../../ipc/client';

interface SheetData {
  name: string;
  rows: string[][];
}

/** 0→A、25→Z、26→AA…（Excel 欄標）。 */
function colLabel(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

const hintStyle: React.CSSProperties = { padding: 'var(--space-6)', color: 'var(--meta)', fontSize: 'var(--text-sm)' };
const cornerCell: React.CSSProperties = { position: 'sticky', left: 0, top: 0, zIndex: 2, background: 'var(--surface)', border: '1px solid var(--border)', minWidth: 44 };
const colHeadCell: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', color: 'var(--meta)', border: '1px solid var(--border)', padding: '2px 8px', textAlign: 'center', fontWeight: 600 };
const rowHeadCell: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface)', color: 'var(--meta)', border: '1px solid var(--border)', padding: '2px 8px', textAlign: 'right', minWidth: 44 };
const bodyCell: React.CSSProperties = { border: '1px solid var(--border-soft)', padding: '2px 8px', whiteSpace: 'nowrap', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--fg)' };

export function SheetView({ wsId, path }: { wsId: string; path: string }): React.JSX.Element {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    setSheets(null);
    setErr(null);
    setActive(0);
    ipc.fs
      .readSheet({ wsId, path })
      .then((r) => {
        if (!alive) return;
        if ('error' in r) setErr(r.error);
        else setSheets(r.sheets);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [wsId, path]);

  if (err) return <div style={{ ...hintStyle, color: 'var(--danger)' }}>無法讀取試算表：{err}</div>;
  if (!sheets) return <div style={hintStyle}>載入試算表…</div>;
  if (sheets.length === 0) return <div style={hintStyle}>空白試算表。</div>;

  const sheet = sheets[Math.min(active, sheets.length - 1)];
  const maxCols = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols = Array.from({ length: maxCols });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
      <div className="pd-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr>
              <th style={cornerCell} aria-hidden="true" />
              {cols.map((_, ci) => (
                <th key={ci} style={colHeadCell}>
                  {colLabel(ci)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri}>
                <td style={rowHeadCell}>{ri + 1}</td>
                {cols.map((_, ci) => (
                  <td key={ci} style={bodyCell} title={row[ci] ?? ''}>
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheets.length > 1 && (
        <div
          role="tablist"
          aria-label="工作表"
          style={{ display: 'flex', gap: 2, borderTop: '1px solid var(--border)', padding: '3px 6px', overflowX: 'auto', flexShrink: 0, background: 'var(--surface)' }}
        >
          {sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              aria-selected={i === active}
              className={`pd-btn${i === active ? ' pd-btn-primary' : ''}`}
              style={{ padding: '2px 10px', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
