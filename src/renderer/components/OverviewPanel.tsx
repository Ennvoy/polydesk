// 總覽面板（overlay）：toolbar「總覽」開，最大化並排顯示——上半用量（claude/codex 的 5h/週額度），
// 下半各工作區的 AI 詳細狀態。訂閱 claude:status（每工作區每工具）+ 開啟時查 ai:usage。Esc / 點外 / × 關閉。

import React, { useEffect, useState } from 'react';
import { ipc } from '../ipc/client';
import { useAppState } from '../state/appStore';
import { overviewBus } from '../state/overviewBus';
import type { AiTool, AiUsage, ClaudeState, RateWindow } from '../../shared/types';

const STATE_VIEW: Record<ClaudeState, { color: string; label: string }> = {
  running: { color: 'var(--success)', label: '執行中' },
  'stopped-await': { color: 'var(--warn)', label: '待確認' },
  done: { color: 'var(--info, #5b9bd5)', label: '已停止' },
  idle: { color: 'var(--meta)', label: '未啟動' },
};
const TOOL_LABEL: Record<AiTool, string> = { claude: 'Claude', codex: 'Codex' };

function formatReset(sec?: number): string {
  if (!sec) return '';
  const ms = sec < 1e12 ? sec * 1000 : sec;
  try {
    return new Date(ms).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Bar({ pct }: { pct: number }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 90 ? 'var(--danger)' : clamped >= 70 ? 'var(--warn)' : 'var(--success)';
  return (
    <div style={{ height: 8, background: 'var(--surface-warm)', borderRadius: 'var(--radius-pill, 4px)', overflow: 'hidden' }}>
      <div style={{ width: `${clamped}%`, height: '100%', background: color, transition: 'width var(--motion-fast) var(--ease-standard)' }} />
    </div>
  );
}

function WindowRow({ label, win }: { label: string; win?: RateWindow }): React.JSX.Element {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--meta)', marginBottom: 3 }}>
        <span>{label}</span>
        <span>{win ? `${Math.round(win.usedPercent)}%${win.resetsAt ? ` · 重置 ${formatReset(win.resetsAt)}` : ''}` : '—'}</span>
      </div>
      <Bar pct={win?.usedPercent ?? 0} />
    </div>
  );
}

function UsageCard({ title, fiveHour, sevenDay, plan }: { title: string; fiveHour?: RateWindow; sevenDay?: RateWindow; plan?: string }): React.JSX.Element {
  const has = fiveHour || sevenDay;
  return (
    <div style={{ flex: 1, minWidth: 240, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md, 8px)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontFamily: 'var(--font-display)' }}>{title}</h3>
        {plan ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--meta)', textTransform: 'capitalize' }}>{plan}</span> : null}
      </div>
      {has ? (
        <>
          <WindowRow label="5 小時" win={fiveHour} />
          <WindowRow label="每週" win={sevenDay} />
        </>
      ) : (
        <div style={{ marginTop: 10, fontSize: 'var(--text-xs)', color: 'var(--meta)', lineHeight: 1.6 }}>
          尚無用量資料{title === 'Claude' ? '（需在 Polydesk 開機注入 statusline 後、claude 跑過一次才會出現）' : ''}
        </div>
      )}
    </div>
  );
}

export function OverviewPanel(): React.JSX.Element | null {
  const [open, setOpen] = useState(overviewBus.isOpen());
  const { workspaces } = useAppState();
  const [states, setStates] = useState<Record<string, ClaudeState>>({}); // `${wsId}::${tool}` → state
  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => overviewBus.subscribe(setOpen), []);

  // 常駐訂閱狀態（不論開關；開啟時才顯示）。
  useEffect(
    () => ipc.events.claude.status((p) => setStates((prev) => ({ ...prev, [`${p.wsId}::${p.tool}`]: p.status?.state ?? 'idle' }))),
    [],
  );

  // 開啟時查用量並每 20 秒自動更新 + Esc 關閉。
  useEffect(() => {
    if (!open) return undefined;
    const fetchUsage = (): void => void ipc.ai.usage().then(setUsage).catch(() => undefined);
    fetchUsage();
    const timer = setInterval(fetchUsage, 20_000);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') overviewBus.close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="總覽"
      onClick={() => overviewBus.close()}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="pd-scroll"
        style={{ margin: 'auto', width: '100%', maxWidth: 1100, maxHeight: '100%', overflow: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 10px)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: 'var(--space-5)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>總覽</h2>
          <button className="pd-btn" style={{ marginLeft: 'auto', padding: '2px 10px' }} aria-label="關閉總覽" onClick={() => overviewBus.close()}>
            關閉
          </button>
        </div>

        {/* 用量 */}
        <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', color: 'var(--meta)' }}>服務用量（5 小時 / 每週）</h3>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <UsageCard title="Claude" fiveHour={usage?.claude?.fiveHour} sevenDay={usage?.claude?.sevenDay} />
          <UsageCard title="Codex" fiveHour={usage?.codex?.fiveHour} sevenDay={usage?.codex?.sevenDay} plan={usage?.codex?.planType} />
        </div>

        {/* 工作區狀態 */}
        <h3 style={{ margin: 'var(--space-5) 0 8px', fontSize: 'var(--text-sm)', color: 'var(--meta)' }}>工作區 AI 狀態</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
          {workspaces.length === 0 ? (
            <div style={{ color: 'var(--meta)', fontSize: 'var(--text-sm)' }}>尚無工作區。</div>
          ) : (
            workspaces.map((ws) => (
              <div key={ws.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md, 8px)', padding: 'var(--space-3) var(--space-4)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }} title={ws.name}>
                  {ws.name}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                  {(['claude', 'codex'] as AiTool[]).map((tool) => {
                    const v = STATE_VIEW[states[`${ws.id}::${tool}`] ?? 'idle'];
                    return (
                      <span key={tool} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-xs)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.color, flexShrink: 0 }} aria-hidden="true" />
                        <span style={{ color: 'var(--meta)' }}>{TOOL_LABEL[tool]}</span>
                        <span style={{ color: v.color }}>{v.label}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
