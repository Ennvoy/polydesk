// 檔案總管樹（F-2，REQ-WS-004 / REQ-MON-005 / REQ-E2E-001）。
// 資料夾 lazy 展開、點檔經 editorBus 開檔；訂閱 fs:change 增量重整受影響目錄。
// 右鍵編輯（VSCode 風）：新增檔/資料夾、改名(F2 inline)、刪除(Del+確認)、剪下/複製/貼上、複製路徑、在檔案總管顯示。
// 全用既有 pd-* class + var(--*) token；role=tree/treeitem + 鍵盤導航 + 互動微狀態。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../state/appStore';
import { ipc } from '../ipc/client';
import { editorBus } from '../state/editorBus';
import { dialog } from './Dialogs/host';
import { registerPanel, SLOT } from '../layout/panelRegistry';
import { DRAG_PATH_MIME } from './Terminal/pathDrop';

interface Entry {
  name: string;
  dir: boolean;
}
type DirStatus = 'loading' | 'loaded' | 'error';
interface DirState {
  status: DirStatus;
  entries?: Entry[];
}
type EditState =
  | { kind: 'rename'; rel: string; dir: boolean; value: string }
  | { kind: 'create'; parentRel: string; dir: boolean; value: string };

const INDENT_BASE = 8;
const INDENT_STEP = 14;

function relDirname(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}
function relBasename(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? rel : rel.slice(i + 1);
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
    <div style={{ padding: 'var(--space-6) var(--space-4)', color: 'var(--meta)', fontSize: 'var(--text-sm)', textAlign: 'center', lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

/** inline 改名/新增的名稱輸入（自動聚焦選取；Enter 送出、Esc 取消、blur 送出）。 */
function NameInput({ initial, dir, indent, onCommit, onCancel }: { initial: string; dir: boolean; indent: number; onCommit: (v: string) => void; onCancel: () => void }): React.JSX.Element {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(v);
    else onCancel();
  };
  return (
    <div className="pd-row" style={{ paddingLeft: indent }} onClick={(e) => e.stopPropagation()}>
      <span style={{ width: 12, flexShrink: 0 }} aria-hidden="true" />
      <span style={{ display: 'flex', color: 'var(--meta)' }} aria-hidden="true">
        {dir ? <FolderIcon open={false} /> : <FileIcon />}
      </span>
      <input
        ref={ref}
        className="pd-input"
        aria-label="名稱"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
        style={{ flex: 1, padding: '0 4px', height: 20, fontSize: 'var(--text-sm)' }}
      />
    </div>
  );
}

/** 右鍵選單一列。 */
function MenuRow({ label, shortcut, danger, onClick }: { label: string; shortcut?: string; danger?: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <div
      className="pd-row"
      role="menuitem"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ gap: 16, padding: '3px 12px', color: danger ? 'var(--danger)' : 'var(--fg-1)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', cursor: 'pointer' }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut ? <span style={{ color: 'var(--meta)', fontSize: 'var(--text-xs)' }}>{shortcut}</span> : null}
    </div>
  );
}

function MenuSep(): React.JSX.Element {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} aria-hidden="true" />;
}

export function Explorer(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState();
  const wsId = activeWorkspaceId;
  const ws = workspaces.find((w) => w.id === wsId) ?? null;

  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ entry: Entry | null; rel: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [clip, setClip] = useState<{ rel: string; name: string; op: 'cut' | 'copy' } | null>(null);
  const [selected, setSelected] = useState<{ rel: string; dir: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // 追最新 wsId：loadDir 完成後比對，切走工作區就丟棄 stale tree（防舊 ws 的樹回頭覆蓋新 ws → 顯示錯 repo）。
  const wsIdRef = useRef(wsId);
  wsIdRef.current = wsId;
  const catcherRef = useRef<HTMLDivElement>(null);

  const loadDir = useCallback(
    async (rel: string): Promise<void> => {
      if (!wsId) return;
      setDirs((p) => ({ ...p, [rel]: { status: 'loading', entries: p[rel]?.entries } }));
      try {
        const res = await ipc.fs.tree({ wsId, dir: rel === '' ? '.' : rel });
        if (wsIdRef.current !== wsId) return; // 切走了工作區：丟棄 stale tree
        setDirs((p) => ({ ...p, [rel]: { status: 'loaded', entries: res.entries } }));
      } catch {
        if (wsIdRef.current === wsId) setDirs((p) => ({ ...p, [rel]: { status: 'error', entries: p[rel]?.entries } }));
      }
    },
    [wsId],
  );

  useEffect(() => {
    setDirs({});
    setExpanded({});
    setEditing(null);
    setSelected(null);
    if (wsId) void loadDir('');
  }, [wsId, loadDir]);

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

  // 右鍵選單：點外 / Esc 關閉。
  useEffect(() => {
    if (!menu) return undefined;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

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

  // ── 編輯 handlers ───────────────────────────────────────────────────────
  const startCreate = (parentRel: string, dir: boolean): void => {
    setMenu(null);
    if (parentRel !== '') {
      setExpanded((p) => ({ ...p, [parentRel]: true }));
      if (!dirsRef.current[parentRel]) void loadDir(parentRel);
    }
    setEditing({ kind: 'create', parentRel, dir, value: '' });
  };
  const startRename = (rel: string, dir: boolean): void => {
    setMenu(null);
    setEditing({ kind: 'rename', rel, dir, value: relBasename(rel) });
  };
  const commitEdit = (value: string): void => {
    const ed = editing;
    setEditing(null);
    if (!ed || !wsId) return;
    const name = value.trim();
    void (async () => {
      if (ed.kind === 'create') {
        if (!name) return;
        const path = ed.parentRel === '' ? name : `${ed.parentRel}/${name}`;
        const r = await ipc.fs.create({ wsId, path, dir: ed.dir });
        if ('error' in r) setErr(r.error);
        else void loadDir(ed.parentRel);
      } else {
        const parentRel = relDirname(ed.rel);
        const to = parentRel === '' ? name : `${parentRel}/${name}`;
        if (name && to !== ed.rel) {
          const r = await ipc.fs.rename({ wsId, from: ed.rel, to });
          if ('error' in r) setErr(r.error);
          else void loadDir(parentRel);
        }
      }
    })();
  };

  const doDelete = async (entry: Entry, rel: string): Promise<void> => {
    setMenu(null);
    const ok = await dialog.confirm({
      title: `刪除「${entry.name}」？`,
      body: entry.dir
        ? '整個資料夾會移到系統資源回收桶（可從回收桶救回）。'
        : '檔案會移到系統資源回收桶（可從回收桶救回）。',
      danger: true,
      confirmText: '刪除',
    });
    if (!ok || !wsId) return;
    const r = await ipc.fs.delete({ wsId, path: rel });
    if ('error' in r) setErr(r.error);
    else void loadDir(relDirname(rel));
  };

  /** rel（/ 分隔）→ Windows 絕對路徑（\ 分隔；無 ws.path 時退相對）。複製路徑與拖曳共用同一組法。 */
  const absPathOf = (rel: string): string => {
    const winRel = rel.replace(/\//g, '\\');
    return ws?.path ? `${ws.path}\\${winRel}` : winRel;
  };

  const copyPath = (rel: string, relative: boolean): void => {
    setMenu(null);
    const text = relative ? rel.replace(/\//g, '\\') : absPathOf(rel);
    // 走 clipboard IPC：renderer 的 navigator.clipboard 被 REQ-SEC-001 權限封鎖（必 NotAllowedError）
    void ipc.clipboard.writeText({ text }).catch(() => undefined);
  };
  const reveal = (rel: string): void => {
    setMenu(null);
    if (wsId) void ipc.fs.reveal({ wsId, path: rel });
  };
  const putClip = (rel: string, name: string, op: 'cut' | 'copy'): void => {
    setClip({ rel, name, op });
    setMenu(null);
  };
  const paste = async (targetDirRel: string): Promise<void> => {
    setMenu(null);
    if (!clip || !wsId) return;
    const to = targetDirRel === '' ? clip.name : `${targetDirRel}/${clip.name}`;
    const r = clip.op === 'cut' ? await ipc.fs.rename({ wsId, from: clip.rel, to }) : await ipc.fs.copy({ wsId, from: clip.rel, to });
    if ('error' in r) {
      setErr(r.error);
      return;
    }
    void loadDir(targetDirRel);
    if (clip.op === 'cut') void loadDir(relDirname(clip.rel));
    setClip(null);
  };

  // Ctrl+V 從系統剪貼簿貼入外部檔案（VSCode 風）。兩段協作、不依賴檔案總管有焦點：
  //   ① keydown：焦點不在可編輯元素時（如點在檔案樹的 div），Chromium 本不會觸發 paste，
  //      故把焦點導到隱藏 catcher（contenteditable）逼瀏覽器把貼上事件送出來。
  //   ② paste（capture）：只攔「檔案型」貼上（types 含 'Files'）→ 匯入檔案總管；文字貼上放行編輯器/終端機。
  useEffect(() => {
    if (!wsId) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'v' && e.key !== 'V')) return;
      const ae = document.activeElement as HTMLElement | null;
      const editable = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (!editable) catcherRef.current?.focus();
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (e.target === catcherRef.current) {
        // catcher 只用來接檔案；不論內容都即時清空避免殘留
        window.setTimeout(() => {
          if (catcherRef.current) catcherRef.current.textContent = '';
        }, 0);
      }
      const cd = e.clipboardData;
      if (!cd || !Array.from(cd.types).includes('Files')) return;
      const files = Array.from(cd.files);
      if (files.length === 0) return;
      e.preventDefault();
      const sources = files.map((f) => ipc.fileUtils.pathForFile(f)).filter((p) => p.length > 0);
      if (sources.length === 0) {
        setErr('無法取得貼上檔案的路徑');
        return;
      }
      const sel = selectedRef.current;
      const destDir = sel ? (sel.dir ? sel.rel : relDirname(sel.rel)) : '';
      void (async () => {
        const r = await ipc.fs.importFiles({ wsId, destDir, sources });
        if ('error' in r) {
          setErr(r.error);
          return;
        }
        if (r.errors?.length) setErr(r.errors.join('；'));
        if (destDir !== '') setExpanded((p) => ({ ...p, [destDir]: true }));
        void loadDir(destDir);
      })();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, [wsId, loadDir]);

  const openMenu = (e: React.MouseEvent, entry: Entry | null, rel: string): void => {
    e.preventDefault();
    e.stopPropagation();
    setErr(null);
    setMenu({ entry, rel, x: e.clientX, y: e.clientY });
  };

  const onRowKeyDown = (e: React.KeyboardEvent, entry: Entry, rel: string): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(entry, rel);
    } else if (e.key === 'F2') {
      e.preventDefault();
      startRename(rel, entry.dir);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void doDelete(entry, rel);
    } else if (entry.dir && e.key === 'ArrowRight' && !expanded[rel]) {
      e.preventDefault();
      toggleDir(rel);
    } else if (entry.dir && e.key === 'ArrowLeft' && expanded[rel]) {
      e.preventDefault();
      toggleDir(rel);
    }
  };

  const renderLevel = (rel: string, depth: number): React.ReactNode => {
    const st = dirs[rel];
    if (!st) return null;
    const entries = st.entries ?? [];
    const indent = INDENT_BASE + depth * INDENT_STEP;
    const creatingHere = editing?.kind === 'create' && editing.parentRel === rel;

    if (st.status === 'loading' && entries.length === 0 && !creatingHere) {
      return (
        <div style={{ paddingLeft: indent, paddingTop: 4, paddingBottom: 4, paddingRight: 'var(--space-3)', color: 'var(--meta)', fontSize: 'var(--text-sm)' }}>載入中…</div>
      );
    }
    if (st.status === 'error') {
      return (
        <div className="pd-row" style={{ paddingLeft: indent, color: 'var(--danger)' }}>
          <span>讀取失敗</span>
          <button className="pd-btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} aria-label="重試載入此資料夾" onClick={() => void loadDir(rel)}>
            重試
          </button>
        </div>
      );
    }

    return (
      <>
        {creatingHere ? (
          <NameInput initial="" dir={editing.dir} indent={indent + 12} onCommit={commitEdit} onCancel={() => setEditing(null)} />
        ) : null}
        {rel !== '' && entries.length === 0 && !creatingHere ? (
          <div style={{ paddingLeft: indent + 18, paddingTop: 2, paddingBottom: 2, paddingRight: 'var(--space-3)', color: 'var(--meta)', fontSize: 'var(--text-xs)' }}>（空）</div>
        ) : null}
        {entries.map((entry) => {
          const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
          const isOpen = !!expanded[childRel];
          if (editing?.kind === 'rename' && editing.rel === childRel) {
            return <NameInput key={childRel} initial={editing.value} dir={entry.dir} indent={indent} onCommit={commitEdit} onCancel={() => setEditing(null)} />;
          }
          return (
            <React.Fragment key={childRel}>
              <div
                className="pd-row"
                role="treeitem"
                aria-level={depth + 1}
                aria-label={entry.name}
                aria-expanded={entry.dir ? isOpen : undefined}
                aria-selected={selected?.rel === childRel}
                tabIndex={0}
                title={entry.name}
                draggable
                onDragStart={(e) => {
                  // 拖到終端機貼絕對路徑（VS Code 慣例）。自訂 MIME 供終端機辨識；text/plain 供
                  // 一般文字 drop 目標（編輯器等）。setData 失敗（受限環境）不致命：拖曳僅無效果。
                  const abs = absPathOf(childRel);
                  try {
                    e.dataTransfer.setData(DRAG_PATH_MIME, abs);
                    e.dataTransfer.setData('text/plain', abs);
                    e.dataTransfer.effectAllowed = 'copy';
                  } catch {
                    /* setData 受限：略過 */
                  }
                }}
                style={{
                  paddingLeft: indent,
                  opacity: clip?.op === 'cut' && clip.rel === childRel ? 0.5 : 1,
                  background: selected?.rel === childRel ? 'var(--surface-warm)' : undefined,
                }}
                onClick={() => {
                  setSelected({ rel: childRel, dir: entry.dir });
                  activate(entry, childRel);
                }}
                onContextMenu={(e) => openMenu(e, entry, childRel)}
                onKeyDown={(e) => onRowKeyDown(e, entry, childRel)}
              >
                {entry.dir ? <Chevron open={isOpen} /> : <span style={{ width: 12, flexShrink: 0 }} aria-hidden="true" />}
                <span style={{ color: entry.dir ? 'var(--fg-2)' : 'var(--meta)', display: 'flex' }}>{entry.dir ? <FolderIcon open={isOpen} /> : <FileIcon />}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              </div>
              {entry.dir && isOpen ? renderLevel(childRel, depth + 1) : null}
            </React.Fragment>
          );
        })}
      </>
    );
  };

  const rootState = dirs[''];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 隱藏 paste catcher：焦點不在可編輯元素時，Ctrl+V 靠它逼出 paste 事件（見上方 useEffect）。 */}
      <div
        ref={catcherRef}
        contentEditable
        suppressContentEditableWarning
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'fixed', left: -9999, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <div className="pd-panel-header">
        <span>總管{ws ? `：${ws.name}` : ''}</span>
        {wsId ? (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            <button className="pd-activity-btn" style={{ width: 24, height: 24, color: 'var(--meta)' }} aria-label="在根目錄新增檔案" title="新增檔案" onClick={() => startCreate('', false)}>
              ＋
            </button>
            <button className="pd-activity-btn" style={{ width: 24, height: 24, color: 'var(--meta)' }} aria-label="重新整理檔案樹" title="重新整理" onClick={() => void loadDir('')}>
              <RefreshIcon />
            </button>
          </span>
        ) : null}
      </div>

      {err ? (
        <div className="pd-scm-error" role="alert" style={{ margin: '4px 8px' }} onClick={() => setErr(null)}>
          {err}
        </div>
      ) : null}

      {!wsId ? (
        <Hint>尚未選擇工作區。請從左側工作區列選擇或新增一個資料夾。</Hint>
      ) : (
        <div
          className="pd-scroll"
          role="tree"
          aria-label={`檔案總管${ws ? `：${ws.name}` : ''}`}
          style={{ flex: 1, minHeight: 0, paddingBottom: 'var(--space-3)' }}
          onContextMenu={(e) => openMenu(e, null, '')}
        >
          {!rootState ? (
            <Hint>載入中…</Hint>
          ) : rootState.status === 'error' && (rootState.entries?.length ?? 0) === 0 ? (
            <div className="pd-row" style={{ color: 'var(--danger)' }} role="treeitem" aria-level={1} aria-label="讀取失敗">
              <span>讀取失敗</span>
              <button className="pd-btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} aria-label="重試載入" onClick={() => void loadDir('')}>
                重試
              </button>
            </div>
          ) : (rootState.entries?.length ?? 0) === 0 && rootState.status === 'loaded' && editing?.kind !== 'create' ? (
            <Hint>此工作區沒有可顯示的檔案。</Hint>
          ) : (
            renderLevel('', 0)
          )}
        </div>
      )}

      {menu ? (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: Math.min(menu.x, window.innerWidth - 220),
            top: Math.min(menu.y, window.innerHeight - 320),
            zIndex: 1000,
            minWidth: 200,
            padding: '4px 0',
            background: 'var(--surface-warm)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md, 6px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {/* 資料夾 / 根：可新增 */}
          {(menu.entry === null || menu.entry.dir) ? (
            <>
              <MenuRow label="新增檔案…" onClick={() => startCreate(menu.entry ? menu.rel : '', false)} />
              <MenuRow label="新增資料夾…" onClick={() => startCreate(menu.entry ? menu.rel : '', true)} />
              {clip ? <MenuRow label="貼上" shortcut="Ctrl+V" onClick={() => void paste(menu.entry ? menu.rel : '')} /> : null}
              {menu.entry ? <MenuSep /> : null}
            </>
          ) : null}
          {/* 針對具體項目（檔案或資料夾） */}
          {menu.entry ? (
            <>
              <MenuRow label="剪下" shortcut="Ctrl+X" onClick={() => putClip(menu.rel, menu.entry!.name, 'cut')} />
              <MenuRow label="複製" shortcut="Ctrl+C" onClick={() => putClip(menu.rel, menu.entry!.name, 'copy')} />
              <MenuSep />
              <MenuRow label="重新命名…" shortcut="F2" onClick={() => startRename(menu.rel, menu.entry!.dir)} />
              <MenuRow label="刪除" shortcut="Del" danger onClick={() => void doDelete(menu.entry!, menu.rel)} />
              <MenuSep />
              <MenuRow label="複製路徑" onClick={() => copyPath(menu.rel, false)} />
              <MenuRow label="複製相對路徑" onClick={() => copyPath(menu.rel, true)} />
              <MenuRow label="在檔案總管中顯示" onClick={() => reveal(menu.rel)} />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// 模組頂層自註冊（features.ts side-effect import 後生效）
registerPanel(SLOT.viewExplorer, Explorer);
