// 終端機面板（REQ-TERM-001~006、REQ-WS-005）：每工作區多終端機，多開時「同時並排/上下顯示、可拖曳調整」
// （react-resizable-panels），取代分頁切換。背景續跑：所有終端機實例保持掛載，切換工作區不 dispose，故 pty
// 程序與 scrollback 皆保留。
//
// 三項互動（本次新增）：
//  1) 拖曳排序：迷你標頭 draggable，drop 到另一標頭＝插到它前面（只在同工作區內重排）。
//  2) 顯示/隱藏：工具列複選清單勾選要顯示哪些終端機；未勾＝隱藏但「不關閉」。實作關鍵——隱藏的終端機
//     其 TerminalView 仍留在背景「掛載」（用 portal 掛到穩定 host 節點、host 移進背景 stash），故 pty 輸出
//     照樣被接住寫進 xterm buffer（main 端是 live 廣播、無重播緩衝，一旦卸載該段輸出即永久掉失，見 PtyManager）。
//     顯示時把同一個 host 節點「原地搬回」對應的並排 slot（appendChild 搬 DOM 節點不觸發 React 重掛載＝
//     xterm/PTY 原封存活）。
//  3) 自訂命名：迷你標頭雙擊改名；未命名＝自動編號（同 shell ≥2 才附序號，如「PowerShell 1／2」）。
//
// 註冊：模組頂層 registerPanel(SLOT.terminal, TerminalPanel)（features.ts side-effect import）。

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { ipc } from '../../ipc/client';
import { useAppState } from '../../state/appStore';
import { registerPanel, SLOT } from '../../layout/panelRegistry';
import { toggleLayoutPanel } from '../../layout/DockLayout';
import { TerminalView } from './TerminalView';
import './terminal.css';
import type { ShellKind } from '../../../shared/types';

interface TermEntry {
  termId: string;
  wsId: string;
  shell: ShellKind;
  alive: boolean;
  exitCode: number | null;
  /** 自訂名稱（undefined／空＝改用自動編號）。 */
  name?: string;
  /** 隱藏但不關閉（背景續跑、輸出續接）。 */
  hidden?: boolean;
}

const SHELL_LABEL: Record<ShellKind, string> = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  pwsh: 'PowerShell 7',
  gitbash: 'Git Bash',
  wsl: 'WSL',
};
const SHELLS: ShellKind[] = ['powershell', 'cmd', 'pwsh', 'gitbash', 'wsl'];

type SplitDir = 'horizontal' | 'vertical';

type AiLauncher = 'claude' | 'codex' | 'agy';

const AI_LAUNCHERS: Record<AiLauncher, { label: string; command: string; title: string }> = {
  claude: {
    label: 'Claude bypass',
    command: 'claude --dangerously-skip-permissions',
    title: '開啟 Claude（bypass：略過所有權限確認，僅限信任的工作區）',
  },
  codex: { label: 'Codex', command: 'codex', title: '開啟 Codex' },
  agy: { label: 'Agy', command: 'agy', title: '開啟 Agy' },
};

/**
 * 計算某工作區內每個終端機的顯示名稱：自訂名優先，否則 shell 名；同 shell 有 ≥2 個時附 1-based 序號
 * （依當前順序，故拖曳排序後序號跟著視覺順序走）。
 */
function computeLabels(list: TermEntry[]): Map<string, string> {
  const total = new Map<ShellKind, number>();
  for (const t of list) total.set(t.shell, (total.get(t.shell) ?? 0) + 1);
  const seen = new Map<ShellKind, number>();
  const out = new Map<string, string>();
  for (const t of list) {
    const n = (seen.get(t.shell) ?? 0) + 1;
    seen.set(t.shell, n);
    const custom = t.name?.trim();
    if (custom) out.set(t.termId, custom);
    else out.set(t.termId, (total.get(t.shell) ?? 0) > 1 ? `${SHELL_LABEL[t.shell]} ${n}` : SHELL_LABEL[t.shell]);
  }
  return out;
}

export function TerminalPanel(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState();
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const [terms, setTerms] = useState<TermEntry[]>([]);
  const [newShell, setNewShell] = useState<ShellKind>(activeWs?.defaultShell ?? 'powershell');
  const [dir, setDir] = useState<SplitDir>('horizontal'); // 並排（左右）預設；可切上下
  const listedWs = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // AI 快捷啟動命令必須等 TerminalView 掛載並訂閱 PTY 輸出後才送，否則 CLI 的第一段畫面可能遺失。
  const pendingLaunchesRef = useRef<Map<string, string>>(new Map());

  // 互動暫態
  const [showHideOpen, setShowHideOpen] = useState(false); // 顯示/隱藏複選清單開合
  const [editingId, setEditingId] = useState<string | null>(null); // 正在改名的 termId
  const [dragId, setDragId] = useState<string | null>(null); // 拖曳中的 termId（僅供視覺高亮；功能判定走 dragIdRef）
  const [dropId, setDropId] = useState<string | null>(null); // 目前 hover 的 drop 目標 termId
  // 拖曳來源同步真相：onDragStart 當下就寫入（不等 React flush），onDragOver/onDrop 一律讀它——
  // 避免「state 尚未 flush → onDragOver 不 preventDefault → 瀏覽器根本不觸發 drop」的時序漏洞。
  const dragIdRef = useRef<string | null>(null);
  // 改名取消旗標：Escape 取消時設 true，讓隨後的 onBlur 不 commit（區分「取消」與「點開/Enter 提交」）。
  const renameCancelRef = useRef(false);

  // portal 穩定 host 節點（每 termId 一個；xterm 掛在此，搬 DOM 位置不重掛載）。
  const hostRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // 各可見終端機的並排 slot（pane-body）DOM，host 顯示時搬進去。
  const slotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // 背景 stash：隱藏 / 非 active 工作區的 host 停在此（display:none，仍掛載＝輸出續接）。
  const stashRef = useRef<HTMLDivElement | null>(null);
  // 顯示/隱藏 popover 容器（點外面關閉用）。
  const showHideRef = useRef<HTMLDivElement | null>(null);

  const getHost = useCallback((termId: string): HTMLDivElement => {
    let h = hostRefs.current.get(termId);
    if (!h) {
      h = document.createElement('div');
      h.className = 'pd-term-host';
      hostRefs.current.set(termId, h);
    }
    return h;
  }, []);

  // 訂閱 pty:exit（一次）：標記結束 + exitCode，供 TerminalView 顯示重啟。
  useEffect(() => {
    const off = ipc.events.pty.exit(({ termId, exitCode }) => {
      setTerms((prev) => prev.map((t) => (t.termId === termId ? { ...t, alive: false, exitCode } : t)));
    });
    return off;
  }, []);

  // 切到某工作區：首次載入其既有終端機（背景續跑時切回可見既有 pty）。
  // 冪等防 StrictMode（listedWs.add 移到列舉成功後才記；merge 以 termId 去重）。
  useEffect(() => {
    const wsId = activeWorkspaceId;
    if (!wsId || listedWs.current.has(wsId)) return;
    void ipc.pty
      .list({ wsId })
      .then((list) => {
        listedWs.current.add(wsId);
        if (list.length === 0) return;
        setTerms((prev) => {
          const known = new Set(prev.map((t) => t.termId));
          const merged = [...prev];
          for (const t of list) {
            if (!known.has(t.termId)) {
              merged.push({ termId: t.termId, wsId: t.wsId, shell: t.shell, alive: t.alive, exitCode: null });
            }
          }
          return merged;
        });
      })
      .catch(() => {
        /* 列舉失敗：使用者可手動「＋」新增 */
      });
  }, [activeWorkspaceId]);

  // 工作區切換時，把新建終端機的預設 shell 同步成該工作區預設。
  useEffect(() => {
    if (activeWs) setNewShell(activeWs.defaultShell);
  }, [activeWs?.id, activeWs?.defaultShell]);

  // 顯示/隱藏 popover：點外面關閉。
  useEffect(() => {
    if (!showHideOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (showHideRef.current && !showHideRef.current.contains(e.target as Node)) setShowHideOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showHideOpen]);

  const createTerm = useCallback(async (
    wsId: string,
    shell: ShellKind,
    launch?: { name: string; command: string },
  ): Promise<void> => {
    setBusy(true);
    try {
      const { termId } = await ipc.pty.create({ wsId, shell });
      if (launch) pendingLaunchesRef.current.set(termId, launch.command);
      setTerms((prev) => [
        ...prev,
        { termId, wsId, shell, alive: true, exitCode: null, name: launch?.name },
      ]);
    } catch {
      /* create 失敗（如非法 shell / 工作區）：不新增，狀態維持清楚 */
    } finally {
      setBusy(false);
    }
  }, []);

  // React 會先掛載子層 TerminalView 的 effect，再執行此父層 effect；此時送命令可完整接住 CLI 初始輸出。
  useEffect(() => {
    for (const t of terms) {
      const command = pendingLaunchesRef.current.get(t.termId);
      if (!command) continue;
      pendingLaunchesRef.current.delete(t.termId);
      ipc.pty.write(t.termId, `${command}\r`);
    }
  }, [terms]);

  const closeTerm = useCallback(async (entry: TermEntry): Promise<void> => {
    await ipc.pty.close({ termId: entry.termId }).catch(() => undefined);
    setTerms((prev) => prev.filter((t) => t.termId !== entry.termId));
  }, []);

  // 崩潰重啟（REQ-TERM-006）：以同 shell 同工作區重建，取代該分頁的 termId（沿用名稱/隱藏狀態）。
  const restartTerm = useCallback(async (entry: TermEntry): Promise<void> => {
    try {
      const { termId } = await ipc.pty.create({ wsId: entry.wsId, shell: entry.shell });
      setTerms((prev) =>
        prev.map((t) => (t.termId === entry.termId ? { ...t, termId, alive: true, exitCode: null } : t)),
      );
    } catch {
      /* 重啟失敗：維持結束狀態 */
    }
  }, []);

  const commitRename = useCallback((termId: string, raw: string): void => {
    const name = raw.trim();
    setTerms((prev) => prev.map((t) => (t.termId === termId ? { ...t, name: name || undefined } : t)));
    setEditingId(null);
  }, []);

  const toggleHidden = useCallback((termId: string): void => {
    setTerms((prev) => prev.map((t) => (t.termId === termId ? { ...t, hidden: !t.hidden } : t)));
  }, []);

  const showAll = useCallback((wsId: string): void => {
    setTerms((prev) => prev.map((t) => (t.wsId === wsId ? { ...t, hidden: false } : t)));
  }, []);

  // 拖曳排序：把 fromId 移到 toId 旁邊（限同工作區）。方向感：拖向後方（from<to）落在目標之後、
  // 拖向前方（from>to）落在目標之前——否則「插到目標前面」會讓往後拖（移除後目標左移一格、又插回其前）
  // 原地不動＝只能往前拖、往後拖沒反應。
  const moveTerm = useCallback((fromId: string, toId: string): void => {
    if (fromId === toId) return;
    setTerms((prev) => {
      const arr = [...prev];
      const from = arr.findIndex((t) => t.termId === fromId);
      const to = arr.findIndex((t) => t.termId === toId);
      if (from < 0 || to < 0 || arr[from].wsId !== arr[to].wsId) return prev;
      const [moved] = arr.splice(from, 1);
      const target = arr.findIndex((t) => t.termId === toId); // 目標在移除 from 後的新索引
      const insertAt = from < to ? target + 1 : target;
      arr.splice(insertAt, 0, moved);
      return arr;
    });
  }, []);

  const activeWsId = activeWs?.id ?? null;

  // 依 active 工作區把 host 節點放進「對應 slot（可見）」或「stash（隱藏／非 active）」；並回收已關閉終端機的 host。
  // 搬 DOM 節點（appendChild）不會讓 portal 內容重掛載（container 身分不變）＝xterm/PTY 原地存活。
  useLayoutEffect(() => {
    const stash = stashRef.current;
    const liveIds = new Set(terms.map((t) => t.termId));
    for (const t of terms) {
      const host = getHost(t.termId);
      const visible = t.wsId === activeWsId && !t.hidden;
      const target = visible ? slotRefs.current.get(t.termId) ?? stash : stash;
      if (target && host.parentNode !== target) target.appendChild(host);
    }
    for (const [id, host] of hostRefs.current) {
      if (!liveIds.has(id)) {
        host.parentNode?.removeChild(host);
        hostRefs.current.delete(id);
      }
    }
  });

  if (!activeWs) {
    return (
      <div className="pd-term-empty" style={emptyStyle} role="status">
        請先選擇工作區後再開啟終端機
      </div>
    );
  }

  const activeTerms = terms.filter((t) => t.wsId === activeWs.id);
  const visibleTerms = activeTerms.filter((t) => !t.hidden);
  const labels = computeLabels(activeTerms);
  const hiddenCount = activeTerms.length - visibleTerms.length;
  const canSplitToggle = visibleTerms.length >= 2;

  return (
    <div className="pd-term-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工具列：N 個並排 / 並排⇄上下 / 顯示-隱藏 / AI 快捷啟動 / shell 切換 / 新增 / 隱藏面板 */}
      <div
        className="pd-panel-header"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', textTransform: 'none' }}
      >
        {/* dockview group 標頭已顯示「終端機」分頁 → 自帶標頭只在多開時補「N 個並排」，避免重複標題。 */}
        <span style={{ color: 'var(--meta)', fontSize: 'var(--text-xs)' }}>
          {visibleTerms.length > 1 ? `${visibleTerms.length} 個並排` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
          <button
            className="pd-btn"
            aria-label={dir === 'horizontal' ? '切換為上下排列' : '切換為並排排列'}
            title={dir === 'horizontal' ? '目前並排（左右）— 點切上下' : '目前上下 — 點切並排'}
            aria-pressed={dir === 'vertical'}
            disabled={!canSplitToggle}
            onClick={() => setDir((d) => (d === 'horizontal' ? 'vertical' : 'horizontal'))}
            style={{ padding: '2px 8px' }}
          >
            {dir === 'horizontal' ? '⇄ 並排' : '⇅ 上下'}
          </button>

          {/* 顯示/隱藏：勾選要顯示哪些終端機（未勾＝隱藏但不關閉、背景續跑）。 */}
          <div ref={showHideRef} className="pd-term-showhide">
            <button
              className={`pd-btn${hiddenCount > 0 ? ' pd-btn-primary' : ''}`}
              aria-label="顯示或隱藏終端機"
              aria-haspopup="true"
              aria-expanded={showHideOpen}
              title="選擇要顯示哪些終端機（未勾選＝隱藏但不關閉，背景續跑）"
              disabled={activeTerms.length < 1}
              onClick={() => setShowHideOpen((o) => !o)}
              style={{ padding: '2px 8px' }}
            >
              ▤ 顯示/隱藏{hiddenCount > 0 ? ` · ${hiddenCount} 隱藏` : ''}
            </button>
            {showHideOpen && (
              <div className="pd-term-showhide-menu">
                {activeTerms.length === 0 ? (
                  <div className="pd-term-showhide-empty">尚無終端機</div>
                ) : (
                  <>
                    {activeTerms.map((t) => (
                      <label key={t.termId} className="pd-term-showhide-item">
                        <input type="checkbox" checked={!t.hidden} onChange={() => toggleHidden(t.termId)} />
                        <span
                          aria-hidden
                          className="pd-term-dot"
                          style={{ background: t.alive ? 'var(--success)' : 'var(--meta)' }}
                        />
                        <span className="pd-term-showhide-label">{labels.get(t.termId)}</span>
                      </label>
                    ))}
                    {hiddenCount > 0 && (
                      <div className="pd-term-showhide-actions">
                        <button className="pd-btn" onClick={() => showAll(activeWs.id)} style={{ padding: '2px 8px' }}>
                          全部顯示
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="pd-term-ai-launchers" aria-label="AI CLI 快捷啟動">
            {(Object.entries(AI_LAUNCHERS) as [AiLauncher, (typeof AI_LAUNCHERS)[AiLauncher]][]).map(
              ([tool, launcher]) => (
                <button
                  key={tool}
                  className={`pd-btn pd-term-ai-launch pd-term-ai-launch--${tool}`}
                  aria-label={`開啟 ${launcher.label}`}
                  title={launcher.title}
                  disabled={busy}
                  onClick={() =>
                    void createTerm(activeWs.id, newShell, { name: launcher.label, command: launcher.command })
                  }
                >
                  {launcher.label}
                </button>
              ),
            )}
          </div>

          <select
            className="pd-input"
            aria-label="新終端機 shell 類型"
            value={newShell}
            onChange={(e) => setNewShell(e.target.value as ShellKind)}
            style={{ width: 'auto', padding: '2px 6px' }}
          >
            {SHELLS.map((s) => (
              <option key={s} value={s}>
                {SHELL_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            className="pd-btn"
            aria-label="新增終端機"
            title="新增終端機"
            disabled={busy}
            onClick={() => void createTerm(activeWs.id, newShell)}
            style={{ padding: '2px 10px' }}
          >
            ＋
          </button>
          {/* 隱藏整個終端機面板（原地隱藏＝setVisible，不 dispose；可從上方「終端機」鈕再開）。 */}
          <button
            className="pd-btn"
            aria-label="隱藏終端機面板"
            title="隱藏終端機面板（可從上方「終端機」鈕再開）"
            onClick={() => toggleLayoutPanel('terminal')}
            style={{ padding: '2px 8px' }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 並排本體：只放 active 工作區的「可見」終端機為 Panel（各 pane-body 是 host 的 slot）。 */}
      <div className="pd-term-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {visibleTerms.length > 0 ? (
          <div style={{ position: 'absolute', inset: 0 }}>
            <Group orientation={dir} style={{ width: '100%', height: '100%' }}>
              {visibleTerms.map((t, i) => (
                <React.Fragment key={t.termId}>
                  {i > 0 && (
                    <Separator
                      className={dir === 'horizontal' ? 'pd-term-handle-h' : 'pd-term-handle-v'}
                      aria-label="拖曳調整終端機大小"
                    />
                  )}
                  <Panel id={t.termId} minSize="8%" style={{ height: '100%' }}>
                    <div className="pd-term-pane">
                      <div
                        className={`pd-term-pane-head${dropId === t.termId && dragId ? ' pd-term-pane-head--drop' : ''}`}
                        draggable={editingId !== t.termId}
                        onDragStart={(e) => {
                          dragIdRef.current = t.termId; // 同步真相：不等 React flush
                          setDragId(t.termId); // 僅供視覺高亮
                          e.dataTransfer.effectAllowed = 'move';
                          try {
                            e.dataTransfer.setData('text/plain', t.termId);
                          } catch {
                            /* 某些環境 setData 受限：dragIdRef 已足夠 */
                          }
                        }}
                        onDragOver={(e) => {
                          // 讀 ref（同步）：確保 flush 前也 preventDefault → 瀏覽器才會觸發 drop。
                          const src = dragIdRef.current ?? e.dataTransfer.getData('text/plain');
                          if (src && src !== t.termId) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (dropId !== t.termId) setDropId(t.termId);
                          }
                        }}
                        onDragLeave={() => {
                          if (dropId === t.termId) setDropId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = dragIdRef.current ?? e.dataTransfer.getData('text/plain');
                          if (from) moveTerm(from, t.termId);
                          dragIdRef.current = null;
                          setDragId(null);
                          setDropId(null);
                        }}
                        onDragEnd={() => {
                          dragIdRef.current = null;
                          setDragId(null);
                          setDropId(null);
                        }}
                        title="拖曳可調整順序；雙擊名稱可重新命名"
                      >
                        <span
                          aria-hidden
                          className="pd-term-dot"
                          style={{ background: t.alive ? 'var(--success)' : 'var(--meta)' }}
                        />
                        {editingId === t.termId ? (
                          <input
                            className="pd-term-pane-rename"
                            defaultValue={t.name ?? labels.get(t.termId) ?? SHELL_LABEL[t.shell]}
                            autoFocus
                            aria-label="重新命名終端機"
                            onMouseDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              // 一律經 blur 提交（單一路徑）；Escape 先設取消旗標 → onBlur 不 commit。
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              else if (e.key === 'Escape') {
                                renameCancelRef.current = true;
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            onBlur={(e) => {
                              if (renameCancelRef.current) {
                                renameCancelRef.current = false;
                                setEditingId(null); // 取消：不保存，退出編輯
                                return;
                              }
                              commitRename(t.termId, e.target.value);
                            }}
                          />
                        ) : (
                          <span
                            className="pd-term-pane-label"
                            title={`${labels.get(t.termId)}（雙擊改名）`}
                            onDoubleClick={() => setEditingId(t.termId)}
                          >
                            {labels.get(t.termId)}
                          </span>
                        )}
                        <span
                          className="pd-term-tab-close"
                          role="presentation"
                          aria-hidden="true"
                          title="關閉終端機"
                          draggable={false}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            void closeTerm(t);
                          }}
                        >
                          ×
                        </span>
                      </div>
                      {/* pane-body＝host 的 slot（host 由 useLayoutEffect 搬入；本身留空）。 */}
                      <div
                        className="pd-term-pane-body"
                        ref={(el) => {
                          if (el) slotRefs.current.set(t.termId, el);
                          else slotRefs.current.delete(t.termId);
                        }}
                      />
                    </div>
                  </Panel>
                </React.Fragment>
              ))}
            </Group>
          </div>
        ) : (
          <div style={emptyStyle} role="status">
            {activeTerms.length === 0
              ? `尚無終端機 — 按右上「＋」開啟（${SHELL_LABEL[newShell]}）`
              : '全部終端機已隱藏（仍在背景執行）— 從「顯示/隱藏」勾選以顯示'}
          </div>
        )}
      </div>

      {/* 背景 stash：隱藏／非 active 工作區的 host 停在此（display:none，仍掛載＝輸出續接）。 */}
      <div className="pd-term-stash" ref={stashRef} aria-hidden />

      {/* 每個終端機一個 portal → 掛到其穩定 host 節點（host 之後由 useLayoutEffect 搬進 slot 或 stash）。 */}
      {terms.map((t) =>
        createPortal(
          <TerminalView
            termId={t.termId}
            shell={t.shell}
            visible={t.wsId === activeWs.id && !t.hidden}
            exitCode={t.exitCode}
            onRestart={() => void restartTerm(t)}
          />,
          getHost(t.termId),
          t.termId,
        ),
      )}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--meta)',
  fontSize: 'var(--text-sm)',
  padding: 'var(--space-6)',
  textAlign: 'center',
};

registerPanel(SLOT.terminal, TerminalPanel);
