// 終端機面板（REQ-TERM-001~006、REQ-WS-005）：每工作區多終端機，多開時「同時並排/上下顯示、可拖曳調整」
// （react-resizable-panels），取代分頁切換。背景續跑：所有終端機實例保持掛載（display 切換），切換工作區
// 不 dispose，故 pty 程序與 scrollback 皆保留。
//
// 註冊：模組頂層 registerPanel(SLOT.terminal, TerminalPanel)（features.ts side-effect import）。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { ipc } from '../../ipc/client';
import { useAppState } from '../../state/appStore';
import { registerPanel, SLOT } from '../../layout/panelRegistry';
import { TerminalView } from './TerminalView';
import './terminal.css';
import type { ShellKind } from '../../../shared/types';

interface TermEntry {
  termId: string;
  wsId: string;
  shell: ShellKind;
  alive: boolean;
  exitCode: number | null;
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

export function TerminalPanel(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState();
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const [terms, setTerms] = useState<TermEntry[]>([]);
  const [newShell, setNewShell] = useState<ShellKind>(activeWs?.defaultShell ?? 'powershell');
  const [dir, setDir] = useState<SplitDir>('horizontal'); // 並排（左右）預設；可切上下
  const listedWs = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // 訂閱 pty:exit（一次）：標記結束 + exitCode，供 TerminalView 顯示重啟。
  useEffect(() => {
    const off = ipc.events.pty.exit(({ termId, exitCode }) => {
      setTerms((prev) => prev.map((t) => (t.termId === termId ? { ...t, alive: false, exitCode } : t)));
    });
    return off;
  }, []);

  // 切到某工作區：首次載入其既有終端機（背景續跑時切回可見既有 pty）。
  useEffect(() => {
    const wsId = activeWorkspaceId;
    if (!wsId || listedWs.current.has(wsId)) return;
    listedWs.current.add(wsId);
    let cancelled = false;
    void ipc.pty
      .list({ wsId })
      .then((list) => {
        if (cancelled || list.length === 0) return;
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
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  // 工作區切換時，把新建終端機的預設 shell 同步成該工作區預設。
  useEffect(() => {
    if (activeWs) setNewShell(activeWs.defaultShell);
  }, [activeWs?.id, activeWs?.defaultShell]);

  const createTerm = useCallback(async (wsId: string, shell: ShellKind): Promise<void> => {
    setBusy(true);
    try {
      const { termId } = await ipc.pty.create({ wsId, shell });
      setTerms((prev) => [...prev, { termId, wsId, shell, alive: true, exitCode: null }]);
    } catch {
      /* create 失敗（如非法 shell / 工作區）：不新增，狀態維持清楚 */
    } finally {
      setBusy(false);
    }
  }, []);

  const closeTerm = useCallback(async (entry: TermEntry): Promise<void> => {
    await ipc.pty.close({ termId: entry.termId }).catch(() => undefined);
    setTerms((prev) => prev.filter((t) => t.termId !== entry.termId));
  }, []);

  // 崩潰重啟（REQ-TERM-006）：以同 shell 同工作區重建，取代該分頁的 termId。
  const restartTerm = useCallback(async (entry: TermEntry): Promise<void> => {
    try {
      const { termId } = await ipc.pty.create({ wsId: entry.wsId, shell: entry.shell });
      setTerms((prev) => prev.map((t) => (t.termId === entry.termId ? { ...t, termId, alive: true, exitCode: null } : t)));
    } catch {
      /* 重啟失敗：維持結束狀態 */
    }
  }, []);

  if (!activeWs) {
    return (
      <div className="pd-term-empty" style={emptyStyle} role="status">
        請先選擇工作區後再開啟終端機
      </div>
    );
  }

  // 以 wsId 分組（所有工作區的終端機皆保持掛載；只顯示 active 工作區那組 → 背景續跑 + 保留 scrollback）。
  const byWs = new Map<string, TermEntry[]>();
  for (const t of terms) {
    const arr = byWs.get(t.wsId);
    if (arr) arr.push(t);
    else byWs.set(t.wsId, [t]);
  }
  const activeCount = (byWs.get(activeWs.id) ?? []).length;

  return (
    <div className="pd-term-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工具列：新增 / shell 切換 / 並排⇄上下 方向切換 */}
      <div
        className="pd-panel-header"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', textTransform: 'none' }}
      >
        <span style={{ color: 'var(--meta)', fontSize: 'var(--text-xs)' }}>
          終端機{activeCount > 0 ? `（${activeCount}）` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
          <button
            className="pd-btn"
            aria-label={dir === 'horizontal' ? '切換為上下排列' : '切換為並排排列'}
            title={dir === 'horizontal' ? '目前並排（左右）— 點切上下' : '目前上下 — 點切並排'}
            aria-pressed={dir === 'vertical'}
            disabled={activeCount < 2}
            onClick={() => setDir((d) => (d === 'horizontal' ? 'vertical' : 'horizontal'))}
            style={{ padding: '2px 8px' }}
          >
            {dir === 'horizontal' ? '⇄ 並排' : '⇅ 上下'}
          </button>
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
        </div>
      </div>

      {/* 各工作區一個 PanelGroup（皆掛載、僅 active 那組可見）；多開＝同時並排/上下、可拖曳調整。 */}
      <div className="pd-term-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {[...byWs.entries()].map(([wsId, list]) => {
          const isActive = wsId === activeWs.id;
          return (
            <div
              key={wsId}
              style={{ position: 'absolute', inset: 0, display: isActive ? 'block' : 'none' }}
              aria-hidden={!isActive}
            >
              <Group orientation={dir} style={{ width: '100%', height: '100%' }}>
                {list.map((t, i) => (
                  <React.Fragment key={t.termId}>
                    {i > 0 && (
                      <Separator
                        className={dir === 'horizontal' ? 'pd-term-handle-h' : 'pd-term-handle-v'}
                        aria-label="拖曳調整終端機大小"
                      />
                    )}
                    <Panel id={t.termId} minSize="8%" className="pd-term-pane">
                      <div className="pd-term-pane-head">
                        <span
                          aria-hidden
                          className="pd-term-dot"
                          style={{ background: t.alive ? 'var(--success)' : 'var(--meta)' }}
                        />
                        <span className="pd-term-pane-label">{SHELL_LABEL[t.shell]}</span>
                        <span
                          className="pd-term-tab-close"
                          role="presentation"
                          aria-hidden="true"
                          title="關閉終端機"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            void closeTerm(t);
                          }}
                        >
                          ×
                        </span>
                      </div>
                      <div className="pd-term-pane-body">
                        <TerminalView termId={t.termId} visible={isActive} exitCode={t.exitCode} onRestart={() => void restartTerm(t)} />
                      </div>
                    </Panel>
                  </React.Fragment>
                ))}
              </Group>
            </div>
          );
        })}
        {activeCount === 0 && (
          <div style={emptyStyle} role="status">
            尚無終端機 — 按右上「＋」開啟（{SHELL_LABEL[newShell]}）
          </div>
        )}
      </div>
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
