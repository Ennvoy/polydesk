// 全域搜尋面板（F-6：REQ-SEARCH-001~005、REQ-E2E-006）。
// search-as-you-type（debounce）→ ipc.search.run；訂閱 ipc.events.search.result 累積、依檔分組顯示、
// 高亮 query；可取消；點命中經 editorBus.openFile 跳檔跳行＋反白命中片段；超量顯示「已截斷」；
// 可取代（全部取代）。檔名命中（kind:'file'）獨立「檔案」群組列最上方，點了直接開檔。
// 全用既有 pd-* class + var(--*) token；每互動元素具 aria-label 與 loading/empty/error 微狀態。
//
// 註冊：模組頂層 registerPanel(SLOT.viewSearch, Search)（features.ts side-effect import 後生效）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../state/appStore';
import { ipc } from '../ipc/client';
import { editorBus } from '../state/editorBus';
import { registerPanel, SLOT } from '../layout/panelRegistry';
import { record } from '../../shared/perf';
import type { SearchHit } from '../../shared/types';

const DEBOUNCE_MS = 200;

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : '搜尋失敗';
}

/** 字面命中高亮（regex 模式長度不定，停用高亮只顯示 preview）。 */
function Highlight({ text, query, enabled }: { text: string; query: string; enabled: boolean }): React.JSX.Element {
  if (!enabled || query.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  let idx = lower.indexOf(q, i);
  while (idx !== -1) {
    if (idx > i) parts.push(<span key={parts.length}>{text.slice(i, idx)}</span>);
    parts.push(
      <mark
        key={parts.length}
        style={{ background: 'var(--hl, rgba(245,217,10,0.30))', color: 'inherit', borderRadius: 2, padding: '0 1px' }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    i = idx + query.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(<span key={parts.length}>{text.slice(i)}</span>);
  return <>{parts}</>;
}

function ToggleBtn(props: {
  active: boolean;
  label: string;
  text: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="pd-btn"
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      onClick={props.onClick}
      style={{
        padding: '2px 8px',
        minWidth: 30,
        fontWeight: 600,
        color: props.active ? 'var(--bg)' : 'var(--meta)',
        background: props.active ? 'var(--accent, #0070f3)' : 'transparent',
        borderColor: props.active ? 'var(--accent, #0070f3)' : undefined,
      }}
    >
      {props.text}
    </button>
  );
}

export function Search(): React.JSX.Element {
  const { activeWorkspaceId } = useAppState();
  const wsId = activeWorkspaceId;

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<'search' | 'replace'>('search');

  const currentSearchId = useRef<string | null>(null);
  const startRef = useRef(0);

  const cancelCurrent = useCallback((): void => {
    const id = currentSearchId.current;
    currentSearchId.current = null;
    if (id) void ipc.search.cancel({ searchId: id }).catch(() => undefined);
  }, []);

  // 單一訂閱（整個元件生命週期）：以 currentSearchId 過濾、累積本次搜尋結果。
  useEffect(() => {
    return ipc.events.search.result((p) => {
      if (p.searchId !== currentSearchId.current) return; // 忽略過期搜尋的殘留事件
      setHits((prev) => (p.hits.length ? prev.concat(p.hits) : prev));
      if (p.truncated) setTruncated(true);
      if (p.done) {
        setSearching(false);
        setReplaceBusy(false);
        try {
          record('search:ui', performance.now() - startRef.current);
        } catch {
          /* perf 量測失敗不致命 */
        }
      }
    });
  }, []);

  const runSearch = useCallback((): void => {
    if (!wsId || query.trim().length === 0) return;
    cancelCurrent();
    startRef.current = performance.now();
    setHits([]);
    setTruncated(false);
    setError(null);
    setSearching(true);
    setLastAction('search');
    ipc.search
      .run({ wsId, query, opts: { regex, caseSensitive } })
      .then(({ searchId }) => {
        currentSearchId.current = searchId;
      })
      .catch((e) => {
        setError(errText(e));
        setSearching(false);
      });
  }, [wsId, query, regex, caseSensitive, cancelCurrent]);

  // debounce：query / 選項 / 工作區變動 → 重搜；空 query 或無工作區 → 清空並取消。
  useEffect(() => {
    if (!wsId || query.trim().length === 0) {
      cancelCurrent();
      setHits([]);
      setSearching(false);
      setTruncated(false);
      return undefined;
    }
    const t = setTimeout(runSearch, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [runSearch, wsId, query, cancelCurrent]);

  // 卸載：取消殘留搜尋（main 端 webContents destroyed 另有保險）。
  useEffect(() => () => cancelCurrent(), [cancelCurrent]);

  const onReplaceAll = useCallback((): void => {
    if (!wsId || query.trim().length === 0) return;
    cancelCurrent();
    startRef.current = performance.now();
    setHits([]);
    setTruncated(false);
    setError(null);
    setReplaceBusy(true);
    setLastAction('replace');
    ipc.search
      .run({ wsId, query, opts: { regex, caseSensitive, replace: replacement } })
      .then(({ searchId }) => {
        currentSearchId.current = searchId;
      })
      .catch((e) => {
        setError(errText(e));
        setReplaceBusy(false);
      });
  }, [wsId, query, regex, caseSensitive, replacement, cancelCurrent]);

  const onCancel = useCallback((): void => {
    cancelCurrent();
    setSearching(false);
    setReplaceBusy(false);
  }, [cancelCurrent]);

  const openHit = useCallback(
    (hit: SearchHit): void => {
      if (!wsId) return;
      if (hit.kind === 'file') {
        editorBus.openFile({ wsId, path: hit.path }); // 檔名命中：開檔即可
        return;
      }
      // Monaco 欄位是 UTF-16 單位、rg col 是 byte 位移（行內含中文會偏）：
      // 優先以 preview 內字面位置換算並反白命中片段；找不到（regex/截斷）退回 rg col 只定位。
      const idx = regex ? -1 : hit.preview.toLowerCase().indexOf(query.toLowerCase());
      editorBus.openFile({
        wsId,
        path: hit.path,
        line: hit.line,
        col: idx >= 0 ? idx + 1 : hit.col,
        selectLen: idx >= 0 ? query.length : 0,
      });
    },
    [wsId, regex, query],
  );

  // 檔名命中（kind:'file'）與內容命中分流；內容依檔分組（保命中先後序）。
  const fileHits = useMemo(() => hits.filter((h) => h.kind === 'file'), [hits]);
  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      if (h.kind === 'file') continue;
      const arr = map.get(h.path);
      if (arr) arr.push(h);
      else map.set(h.path, [h]);
    }
    return [...map.entries()];
  }, [hits]);

  const busy = searching || replaceBusy;
  const hasQuery = query.trim().length > 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="pd-panel-header">
        <span>搜尋</span>
        <button
          type="button"
          className="pd-activity-btn"
          aria-label={showReplace ? '隱藏取代欄' : '顯示取代欄'}
          aria-pressed={showReplace}
          title="取代"
          onClick={() => setShowReplace((v) => !v)}
          style={{ width: 24, height: 24, marginLeft: 'auto', color: showReplace ? 'var(--accent, #0070f3)' : 'var(--meta)' }}
        >
          ⇄
        </button>
      </div>

      {/* 查詢列 */}
      <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            className="pd-input"
            aria-label="搜尋字詞"
            placeholder="搜尋…"
            value={query}
            disabled={!wsId}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            style={{ flex: 1, minWidth: 0 }}
          />
          <ToggleBtn active={caseSensitive} label="區分大小寫" text="Aa" onClick={() => setCaseSensitive((v) => !v)} />
          <ToggleBtn active={regex} label="使用正則表達式" text=".*" onClick={() => setRegex((v) => !v)} />
        </div>

        {showReplace && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input
              className="pd-input"
              aria-label="取代為"
              placeholder="取代為…"
              value={replacement}
              disabled={!wsId}
              onChange={(e) => setReplacement(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className="pd-btn pd-btn-primary"
              aria-label="全部取代"
              title="全部取代"
              disabled={!wsId || !hasQuery || busy}
              onClick={onReplaceAll}
              style={{ padding: '2px 10px' }}
            >
              {replaceBusy ? '取代中…' : '全部取代'}
            </button>
          </div>
        )}

        {/* 狀態列：搜尋中可取消 / 截斷提示 */}
        {(busy || truncated) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--meta)' }}>
            {busy && (
              <>
                <span role="status" aria-live="polite">
                  {replaceBusy ? '取代中…' : '搜尋中…'}
                </span>
                <button type="button" className="pd-btn" aria-label="取消搜尋" onClick={onCancel} style={{ padding: '1px 8px' }}>
                  取消
                </button>
              </>
            )}
            {truncated && (
              <span style={{ marginLeft: 'auto', color: 'var(--warn, var(--meta))' }}>已達上限，結果已截斷</span>
            )}
          </div>
        )}
      </div>

      {/* 結果區 */}
      <div className="pd-scroll" role="region" aria-label="搜尋結果" style={{ flex: 1, minHeight: 0, paddingBottom: 'var(--space-3)' }}>
        {!wsId ? (
          <Hint>請先選擇一個工作區，再進行搜尋。</Hint>
        ) : error ? (
          <div className="pd-row" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : !hasQuery ? (
          <Hint>輸入字詞以搜尋目前工作區的檔名與內容（自動略過 node_modules、.git 等）。</Hint>
        ) : lastAction === 'replace' && !replaceBusy ? (
          <div style={{ padding: 'var(--space-3)' }}>
            <div style={{ color: 'var(--success)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
              已取代 {groups.length} 個檔案。
            </div>
            {groups.map(([path, hs]) => (
              <div key={path} className="pd-row" style={{ color: 'var(--meta)', fontSize: 'var(--text-sm)' }} title={path}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                <span style={{ marginLeft: 'auto' }}>{hs[0]?.preview}</span>
              </div>
            ))}
          </div>
        ) : hits.length === 0 && !searching ? (
          <Hint>查無符合的結果。</Hint>
        ) : hits.length === 0 && searching ? (
          <Hint>搜尋中…</Hint>
        ) : (
          <>
          {fileHits.length > 0 && (
            <div>
              <div
                className="pd-row"
                style={{ position: 'sticky', top: 0, background: 'var(--bg-1, var(--bg))', color: 'var(--fg-2)', fontWeight: 600, gap: 'var(--space-2)' }}
              >
                <span>檔案（檔名符合）</span>
                <span style={{ marginLeft: 'auto', color: 'var(--meta)', fontWeight: 400, fontSize: 'var(--text-xs)' }}>
                  {fileHits.length}
                </span>
              </div>
              {fileHits.map((h) => (
                <button
                  key={h.path}
                  type="button"
                  className="pd-row"
                  aria-label={`開啟檔案 ${h.path}`}
                  title={h.path}
                  onClick={() => openHit(h)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    paddingLeft: 'var(--space-6)',
                    gap: 'var(--space-2)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-sm)' }}>
                    {/* 檔名比對永遠是字面（regex 選項不影響），highlight 恆開 */}
                    <Highlight text={h.preview} query={query} enabled />
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: 'var(--meta)',
                      fontSize: 'var(--text-xs)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flexShrink: 1,
                    }}
                  >
                    {h.path.includes('/') ? h.path.slice(0, h.path.lastIndexOf('/')) : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {groups.map(([path, lineHits]) => (
            <div key={path}>
              <div
                className="pd-row"
                style={{ position: 'sticky', top: 0, background: 'var(--bg-1, var(--bg))', color: 'var(--fg-2)', fontWeight: 600, gap: 'var(--space-2)' }}
                title={path}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--meta)', fontWeight: 400, fontSize: 'var(--text-xs)' }}>
                  {lineHits.length}
                </span>
              </div>
              {lineHits.map((h, i) => (
                <button
                  key={`${h.line}:${h.col}:${i}`}
                  type="button"
                  className="pd-row"
                  aria-label={`${path} 第 ${h.line} 行：${h.preview}`}
                  title={`第 ${h.line} 行`}
                  onClick={() => openHit(h)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    paddingLeft: 'var(--space-6)',
                    gap: 'var(--space-2)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: 'var(--meta)', fontSize: 'var(--text-xs)', minWidth: 32, textAlign: 'right', flexShrink: 0 }}>
                    {h.line}
                  </span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    <Highlight text={h.preview} query={query} enabled={!regex} />
                  </span>
                </button>
              ))}
            </div>
          ))}
          </>
        )}
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--space-6) var(--space-4)',
        color: 'var(--meta)',
        fontSize: 'var(--text-sm)',
        textAlign: 'center',
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

// 模組頂層自註冊（features.ts side-effect import 後生效）。
registerPanel(SLOT.viewSearch, Search);
