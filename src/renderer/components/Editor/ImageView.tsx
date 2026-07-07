// 圖片唯讀預覽：fs:readImage 回 data URI，置中顯示；「符合視窗／實際大小」切換＋尺寸/檔案大小資訊列。
// 不進 Monaco（避免二進位亂碼）；SVG 經 <img> 載入不執行腳本（瀏覽器規格）。
import React, { useEffect, useState } from 'react';
import { ipc } from '../../ipc/client';

const hintStyle: React.CSSProperties = { padding: 'var(--space-6)', color: 'var(--meta)', fontSize: 'var(--text-sm)' };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageView({ wsId, path }: { wsId: string; path: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [bytes, setBytes] = useState(0);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fit, setFit] = useState(true);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setDim(null);
    setErr(null);
    ipc.fs
      .readImage({ wsId, path })
      .then((r) => {
        if (!alive) return;
        if ('error' in r) setErr(r.error);
        else {
          setSrc(r.dataUri);
          setBytes(r.bytes);
        }
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [wsId, path]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--border-soft)',
          flexShrink: 0,
          color: 'var(--meta)',
          fontSize: 'var(--text-xs)',
        }}
      >
        <span>{dim ? `${dim.w} × ${dim.h}` : '…'}</span>
        <span>·</span>
        <span>{fmtBytes(bytes)}</span>
        <button
          type="button"
          className="pd-btn"
          aria-label={fit ? '以實際大小顯示' : '縮放至符合視窗'}
          aria-pressed={!fit}
          onClick={() => setFit((v) => !v)}
          style={{ marginLeft: 'auto', padding: '2px 10px', flexShrink: 0 }}
        >
          {fit ? '實際大小' : '符合視窗'}
        </button>
      </div>
      <div
        className="pd-scroll"
        role="region"
        aria-label="圖片預覽"
        style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}
      >
        {err ? (
          <div style={{ ...hintStyle, color: 'var(--danger)' }}>無法讀取圖片：{err}</div>
        ) : !src ? (
          <div style={hintStyle}>載入圖片…</div>
        ) : (
          <img
            src={src}
            alt={path}
            onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={
              fit
                ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
                : { maxWidth: 'none', maxHeight: 'none', margin: 'auto' }
            }
          />
        )}
      </div>
    </div>
  );
}
