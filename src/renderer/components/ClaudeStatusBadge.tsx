// Claude 執行狀態徽章（REQ-MON-001/002 的 renderer 殼；真實狀態由 F-8 ClaudeStatusMonitor 推播）。
// 訂閱 ipc.events.claude.status，只處理本 wsId（payload 涵蓋所有工作區）。
// 三態：running 綠脈動 / stopped-await 琥珀 / idle 灰；預設 idle。
//
// 紅軍對應（F-1-A6）：
//   - 只認 props.wsId 的事件（防別的工作區狀態污染本徽章 → 對錯工作區誤接手/誤中斷）。
//   - useEffect 回傳 unsubscribe（防卸載後 ipcRenderer listener 累積洩漏）。
//   - 初值預設 'idle'（事件僅變更時推，首次掛載無狀態 → 灰，不崩潰）。
//   - 脈動動畫尊重 prefers-reduced-motion。

import React, { useEffect, useState } from 'react';
import { ipc } from '../ipc/client';
import type { ClaudeState } from '../../shared/types';

const VIEW: Record<ClaudeState, { color: string; label: string; pulse: boolean }> = {
  running: { color: 'var(--success)', label: '執行中', pulse: true },
  'stopped-await': { color: 'var(--warn)', label: '已停待接手', pulse: false },
  idle: { color: 'var(--meta)', label: '未啟動', pulse: false },
};

const STYLE_ID = 'pdws-claude-badge-style';
function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = [
    '.pdws-claude-dot{width:8px;height:8px;border-radius:var(--radius-pill);display:inline-block;flex-shrink:0;}',
    '@keyframes pdws-claude-pulse{0%,100%{box-shadow:0 0 0 0 currentColor;opacity:1;}50%{box-shadow:0 0 0 3px transparent;opacity:0.4;}}',
    '.pdws-claude-dot.is-pulse{animation:pdws-claude-pulse 1.4s var(--ease-standard) infinite;}',
    '@media (prefers-reduced-motion: reduce){.pdws-claude-dot.is-pulse{animation:none;}}',
  ].join('');
  document.head.appendChild(el);
}

export function ClaudeStatusBadge({ wsId }: { wsId: string }): React.JSX.Element {
  const [state, setState] = useState<ClaudeState>('idle');

  useEffect(() => {
    ensureStyle();
    const unsub = ipc.events.claude.status((p) => {
      if (p.wsId !== wsId) return; // 只認本工作區的事件
      setState(p.status?.state ?? 'idle');
    });
    return unsub; // 卸載退訂，防 listener 洩漏
  }, [wsId]);

  const v = VIEW[state];
  return (
    <span
      role="status"
      aria-label={`Claude 狀態：${v.label}`}
      title={`Claude：${v.label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
    >
      <span
        className={`pdws-claude-dot${v.pulse ? ' is-pulse' : ''}`}
        style={{ background: v.color, color: v.color }}
        aria-hidden="true"
      />
      {/* PE-2：非未啟動才顯示文字標籤（執行中/待接手＝需注意的狀態，draw attention；idle 只留灰點不擾）。 */}
      {state !== 'idle' && (
        <span aria-hidden="true" style={{ fontSize: 'var(--text-xs)', color: v.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {v.label}
        </span>
      )}
    </span>
  );
}
