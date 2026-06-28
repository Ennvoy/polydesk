// 檔案總管樹（F-2，REQ-WS-004 / REQ-MON-005 / REQ-E2E-001）。
// 資料夾 lazy 展開、點檔經 editorBus 開檔；訂閱 fs:change 增量重整受影響目錄。
// 全用既有 pd-* class + var(--*) token；role=tree/treeitem + 鍵盤導航 + 互動微狀態。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../state/appStore';
import { ipc } from '../ipc/client';
import { editorBus } from '../state/editorBus';
import { registerPanel, SLOT } from '../layout/panelRegistry';

interface Entry {
  name: string;
  dir: boolean;
}
type DirStatus = 'loading' | 'loaded' | 'error';
interface DirState {
  status: DirStatus;
  entries?: Entry[];
}

const INDENT_BASE = 8;
const INDENT_STEP = 14;

function relDirname(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform var(--motion-fast) var(--ease-standard)',
      }}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {open ? (
        <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v1H6l-2 8a1 1 0 0 1-1-1z" />
      ) : (
        <path d="M4 5h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      )}
    </svg>
  );
}

function FileIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" />
      <path d="M13 3v5h5" />
    </svg>
  );
}

function RefreshIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5" />
    </svg>
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

export function Explorer(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState();
  const wsId = activeWorkspaceId;
  const ws = workspaces.find((w) => w.id === wsId) ?? null;

  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;

  const loadDir = useCallback(
    async (rel: string): Promise<void> => {
      if (!wsId) return;
      setDirs((p) => ({ ...p, [rel]: { status: 'loading', entries: p[rel]?.entries } }));
      try {
        const res = await ipc.fs.tree({ wsId, dir: rel === '' ? '.' : rel });
        setDirs((p) => ({ ...p, [rel]: { status: 'loaded', entries: res.entries } }));
      } catch {
        setDirs((p) => ({ ...p, [rel]: { status: 'error', entries: p[rel]?.entries } }));
      }
    },
    [wsId],
  );

  // 切換工作區：重置樹並載入根目錄
  useEffect(() => {
    setDirs({});
    setExpanded({});
    if (wsId) void loadDir('');
  }, [wsId, loadDir]);

  // 訂閱 fs:change（逐檔語意，path＝工作區相對 POSIX）：只處理本工作區 → 重抓變動檔的父目錄。
  // 根訊號（path===''：根層檔變動，或事件洪水的 coarse 收斂訊號）＝重抓所有已載入層。
  useEffect(() => {
    if (!wsId) return undefined;
    return ipc.events.fs.change((payload) => {
      if (payload.wsId !== wsId) return;
      const rel = payload.path;
      if (rel === '') {
        for (const k of Object.keys(dirsRef.current)) {
          if (dirsRef.current[k]?.status === 'loaded') void loadDir(k);
        }
        return;
      }
      const parent = relDirname(rel);
      if (parent === '' || dirsRef.current[parent]?.status === 'loaded') void loadDir(parent);
    });
  }, [wsId, loadDir]);

  const toggleDir = useCallback(
    (rel: string): void => {
      setExpanded((p) => {
        const willOpen = !p[rel];
        if (willOpen) {
          const st = dirsRef.current[rel];
          if (!st || st.status === 'error') void loadDir(rel);
        }
        return { ...p, [rel]: willOpen };
      });
    },
    [loadDir],
  );

  const activate = useCallback(
    (entry: Entry, rel: string): void => {
      if (entry.dir) toggleDir(rel);
      else if (wsId) editorBus.openFile({ wsId, path: rel });
    },
    [toggleDir, wsId],
  );

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent, entry: Entry, rel: string): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(entry, rel);
      } else if (entry.dir && e.key === 'ArrowRight' && !expanded[rel]) {
        e.preventDefault();
        toggleDir(rel);
      } else if (entry.dir && e.key === 'ArrowLeft' && expanded[rel]) {
        e.preventDefault();
        toggleDir(rel);
      }
    },
    [activate, toggleDir, expanded],
  );

  const renderLevel = (rel: string, depth: number): React.ReactNode => {
    const st = dirs[rel];
    if (!st) return null;
    const entries = st.entries ?? [];

    if (st.status === 'loading' && entries.length === 0) {
      return (
        <div style={{ paddingLeft: INDENT_BASE + depth * INDENT_STEP, paddingTop: 4, paddingBottom: 4, paddingRight: 'var(--space-3)', color: 'var(--meta)', fontSize: 'var(--text-sm)' }}>
          載入中…
        </div>
      );
    }
    if (st.status === 'error') {
      return (
        <div className="pd-row" style={{ paddingLeft: INDENT_BASE + depth * INDENT_STEP, color: 'var(--danger)' }}>
          <span>讀取失敗</span>
          <button className="pd-btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} aria-label="重試載入此資料夾" onClick={() => void loadDir(rel)}>
            重試
          </button>
        </div>
      );
    }
    if (rel !== '' && entries.length === 0) {
      return (
        <div style={{ paddingLeft: INDENT_BASE + depth * INDENT_STEP + 18, paddingTop: 2, paddingBottom: 2, paddingRight: 'var(--space-3)', color: 'var(--meta)', fontSize: 'var(--text-xs)' }}>
          （空）
        </div>
      );
    }

    return entries.map((entry) => {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const isOpen = !!expanded[childRel];
      return (
        <React.Fragment key={childRel}>
          <div
            className="pd-row"
            role="treeitem"
            aria-level={depth + 1}
            aria-label={entry.name}
            aria-expanded={entry.dir ? isOpen : undefined}
            tabIndex={0}
            title={entry.name}
            style={{ paddingLeft: INDENT_BASE + depth * INDENT_STEP }}
            onClick={() => activate(entry, childRel)}
            onKeyDown={(e) => onRowKeyDown(e, entry, childRel)}
          >
            {entry.dir ? (
              <Chevron open={isOpen} />
            ) : (
              <span style={{ width: 12, flexShrink: 0 }} aria-hidden="true" />
            )}
            <span style={{ color: entry.dir ? 'var(--fg-2)' : 'var(--meta)', display: 'flex' }}>
              {entry.dir ? <FolderIcon open={isOpen} /> : <FileIcon />}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
          </div>
          {entry.dir && isOpen ? renderLevel(childRel, depth + 1) : null}
        </React.Fragment>
      );
    });
  };

  const rootState = dirs[''];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="pd-panel-header">
        <span>總管{ws ? `：${ws.name}` : ''}</span>
        {wsId ? (
          <button
            className="pd-activity-btn"
            style={{ width: 24, height: 24, color: 'var(--meta)' }}
            aria-label="重新整理檔案樹"
            title="重新整理"
            onClick={() => void loadDir('')}
          >
            <RefreshIcon />
          </button>
        ) : null}
      </div>

      {!wsId ? (
        <Hint>尚未選擇工作區。請從左側工作區列選擇或新增一個資料夾。</Hint>
      ) : (
        <div className="pd-scroll" role="tree" aria-label={`檔案總管${ws ? `：${ws.name}` : ''}`} style={{ flex: 1, minHeight: 0, paddingBottom: 'var(--space-3)' }}>
          {!rootState ? (
            <Hint>載入中…</Hint>
          ) : rootState.status === 'error' && (rootState.entries?.length ?? 0) === 0 ? (
            <div className="pd-row" style={{ color: 'var(--danger)' }} role="treeitem" aria-level={1} aria-label="讀取失敗">
              <span>讀取失敗</span>
              <button className="pd-btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} aria-label="重試載入" onClick={() => void loadDir('')}>
                重試
              </button>
            </div>
          ) : (rootState.entries?.length ?? 0) === 0 && rootState.status === 'loaded' ? (
            <Hint>此工作區沒有可顯示的檔案。</Hint>
          ) : (
            renderLevel('', 0)
          )}
        </div>
      )}
    </div>
  );
}

// 模組頂層自註冊（features.ts side-effect import 後生效）
registerPanel(SLOT.viewExplorer, Explorer);
