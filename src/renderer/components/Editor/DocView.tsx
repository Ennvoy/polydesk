// Word 文件唯讀預覽：docx/docm → fs:readDoc 回 mammoth HTML（圖片內嵌 data URI），
// 經 DOMPurify 消毒後渲染（文件內腳本/事件一律剝除）；doc（舊格式）→ 純文字（無圖無格式）。
// 上方固定「用系統程式開啟」——要編輯就交給 Word/WPS，存檔後重開分頁即看到新內容。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { ipc } from '../../ipc/client';

type DocData = { kind: 'html'; html: string } | { kind: 'text'; text: string };

const hintStyle: React.CSSProperties = { padding: 'var(--space-6)', color: 'var(--meta)', fontSize: 'var(--text-sm)' };

export function DocView({ wsId, path }: { wsId: string; path: string }): React.JSX.Element {
  const [data, setData] = useState<DocData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    ipc.fs
      .readDoc({ wsId, path })
      .then((r) => {
        if (!alive) return;
        if ('error' in r) setErr(r.error);
        else setData(r);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [wsId, path]);

  const html = useMemo(
    () => (data?.kind === 'html' ? DOMPurify.sanitize(data.html, { USE_PROFILES: { html: true } }) : ''),
    [data],
  );

  const openExternal = useCallback((): void => {
    setOpenErr(null);
    ipc.fs
      .openExternal({ wsId, path })
      .then((r) => {
        if ('error' in r) setOpenErr(r.error);
      })
      .catch((e) => setOpenErr(e instanceof Error ? e.message : String(e)));
  }, [wsId, path]);

  // 文件內超連結不得讓 Electron 視窗導航走（消毒後仍可能有 href）
  const blockNav = useCallback((e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a');
    if (a) e.preventDefault();
  }, []);

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
        }}
      >
        <span style={{ color: 'var(--meta)', fontSize: 'var(--text-xs)' }}>
          唯讀預覽{data?.kind === 'text' ? '（舊版 .doc：僅文字，無圖片/格式）' : ''}——要編輯請用系統程式開啟
        </span>
        <button
          type="button"
          className="pd-btn"
          aria-label="用系統程式開啟"
          onClick={openExternal}
          style={{ marginLeft: 'auto', padding: '2px 10px', flexShrink: 0 }}
        >
          用系統程式開啟
        </button>
      </div>
      {openErr && (
        <div role="alert" style={{ padding: '4px var(--space-3)', color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>
          無法開啟：{openErr}
        </div>
      )}
      <div className="pd-scroll" role="region" aria-label="文件預覽" style={{ flex: 1, minHeight: 0 }}>
        {err ? (
          <div style={{ ...hintStyle, color: 'var(--danger)' }}>無法讀取文件：{err}</div>
        ) : !data ? (
          <div style={hintStyle}>載入文件…</div>
        ) : data.kind === 'html' ? (
          // eslint-disable-next-line react/no-danger -- mammoth 輸出已經 DOMPurify 消毒
          <div className="pd-doc-prose" onClickCapture={blockNav} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre
            className="pd-doc-prose"
            style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'transparent' }}
          >
            {data.text}
          </pre>
        )}
      </div>
    </div>
  );
}
