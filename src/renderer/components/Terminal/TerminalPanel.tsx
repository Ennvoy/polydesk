// 終端機面板（REQ-TERM-001~006、REQ-WS-005）：每工作區多分頁 + 「＋」新增 + shell 切換 +
// 個別關閉 + 崩潰重啟。背景續跑：所有終端機實例保持掛載（display 切換），切換工作區不 dispose，
// 故 pty 程序與 scrollback 皆保留（REQ-WS-005）。
//
// 註冊：模組頂層 registerPanel(SLOT.terminal, TerminalPanel)（features.ts side-effect import）。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../../ipc/client';
import { useAppState } from '../../state/appStore';
import { registerPanel, SLOT } from '../../layout/panelRegistry';
import { TerminalView } from './TerminalView';
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

export function TerminalPanel(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState();
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const [terms, setTerms] = useState<TermEntry[]>([]);
  const [activeByWs, setActiveByWs] = useState<Record<string, string>>({});
  const [newShell, setNewShell] = useState<ShellKind>(activeWs?.defaultShell ?? 'powershell');
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
        setActiveByWs((prev) => (prev[wsId] ? prev : { ...prev, [wsId]: list[0].termId }));
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

  const createTerm = useCallback(
    async (wsId: string, shell: ShellKind): Promise<void> => {
      setBusy(true);
      try {
        const { termId } = await ipc.pty.create({ wsId, shell });
        setTerms((prev) => [...prev, { termId, wsId, shell, alive: true, exitCode: null }]);
        setActiveByWs((prev) => ({ ...prev, [wsId]: termId }));
      } catch {
        /* create 失敗（如非法 shell / 工作區）：不新增分頁，狀態維持清楚 */
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const closeTerm = useCallback(
    async (entry: TermEntry): Promise<void> => {
      await ipc.pty.close({ termId: entry.termId }).catch(() => undefined);
      setTerms((prev) => prev.filter((t) => t.termId !== entry.termId));
      setActiveByWs((prev) => {
        if (prev[entry.wsId] !== entry.termId) return prev;
        const rest = terms.filter((t) => t.wsId === entry.wsId && t.termId !== entry.termId);
        const next = { ...prev };
        if (rest.length) next[entry.wsId] = rest[0].termId;
        else delete next[entry.wsId];
        return next;
      });
    },
    [terms],
  );

  // 崩潰重啟（REQ-TERM-006）：以同 shell 同工作區重建，取代該分頁的 termId。
  const restartTerm = useCallback(
    async (entry: TermEntry): Promise<void> => {
      try {
        const { termId } = await ipc.pty.create({ wsId: entry.wsId, shell: entry.shell });
        setTerms((prev) =>
          prev.map((t) =>
            t.termId === entry.termId ? { ...t, termId, alive: true, exitCode: null } : t,
          ),
        );
        setActiveByWs((prev) => ({ ...prev, [entry.wsId]: termId }));
      } catch {
        /* 重啟失敗：維持結束狀態 */
      }
    },
    [],
  );

  if (!activeWs) {
    return (
      <div className="pd-term-empty" style={emptyStyle} role="status">
        請先選擇工作區後再開啟終端機
      </div>
    );
  }

  const wsTerms = terms.filter((t) => t.wsId === activeWs.id);
  const activeTermId = activeByWs[activeWs.id] ?? wsTerms[0]?.termId ?? null;

  return (
    <div className="pd-term-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 分頁列 + 新增/shell 切換 */}
      <div
        className="pd-panel-header pd-scroll"
        role="tablist"
        aria-label="終端機分頁"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', overflowX: 'auto', textTransform: 'none' }}
      >
        {wsTerms.map((t) => {
          const isActive = t.termId === activeTermId;
          return (
            <div
              key={t.termId}
              className={`pd-row${isActive ? ' is-active' : ''}`}
              role="tab"
              aria-selected={isActive}
              aria-label={`${SHELL_LABEL[t.shell]} 終端機${t.alive ? '' : '（已結束）'}`}
              tabIndex={0}
              onClick={() => setActiveByWs((prev) => ({ ...prev, [activeWs.id]: t.termId }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveByWs((prev) => ({ ...prev, [activeWs.id]: t.termId }));
                }
              }}
              style={{ flexShrink: 0, paddingRight: 'var(--space-1)' }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 'var(--radius-pill)',
                  background: t.alive ? 'var(--success)' : 'var(--meta)',
                  flexShrink: 0,
                }}
              />
              <span>{SHELL_LABEL[t.shell]}</span>
              <button
                className="pd-term-tab-close"
                aria-label={`關閉 ${SHELL_LABEL[t.shell]} 終端機`}
                title="關閉"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTerm(t);
                }}
                style={tabCloseStyle}
              >
                ×
              </button>
            </div>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
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

      {/* 終端機輸出區：所有工作區的實例皆保持掛載（背景續跑 + 保留 scrollback），
          僅以 display 切換顯示；故切換工作區不 dispose 任一 pty/xterm（REQ-WS-005）。 */}
      <div className="pd-term-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {terms.map((t) => (
          <TerminalView
            key={t.termId}
            termId={t.termId}
            visible={t.wsId === activeWs.id && t.termId === activeTermId}
            exitCode={t.exitCode}
            onRestart={() => void restartTerm(t)}
          />
        ))}
        {wsTerms.length === 0 && (
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

const tabCloseStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--meta)',
  cursor: 'pointer',
  fontSize: 'var(--text-base)',
  lineHeight: 1,
  padding: '0 4px',
  borderRadius: 'var(--radius-sm)',
};

registerPanel(SLOT.terminal, TerminalPanel);
