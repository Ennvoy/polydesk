// Claude 執行狀態徽章（REQ-MON-001/002 的 renderer 殼；真實狀態由 F-8 ClaudeStatusMonitor 推播）。
// 訂閱 ipc.events.claude.status，只處理本 wsId（payload 涵蓋所有工作區）。
// 三態：running 綠脈動 / stopped-await 琥珀 / idle 灰；預設 idle。
//
// 紅軍對應（F-1-A6）：
//   - 只認 props.wsId 的事件（防別的工作區狀態污染本徽章 → 對錯工作區誤接手/誤中斷）。
//   - useEffect 回傳 unsubscribe（防卸載後 ipcRenderer listener 累積洩漏）。
//   - 初值預設 'idle'；掛載先拉 claude:states 快照補現況（main 只在變更時推事件，
//     重掛（如切側欄）後沒有快照就會永遠空白），事件比快照新 → 合併時事件優先。
//   - 脈動動畫尊重 prefers-reduced-motion。

import React, { useEffect, useState } from 'react';
import { ipc } from '../ipc/client';
import type { AiTool, ClaudeState } from '../../shared/types';

const VIEW: Record<ClaudeState, { color: string; label: string; pulse: boolean }> = {
  running: { color: 'var(--success)', label: '執行中', pulse: true }, // 跑工具/subagent/workflow
  'stopped-await': { color: 'var(--warn)', label: '待確認', pulse: true }, // 問你問題/要權限（需注意 → 脈動）
  done: { color: 'var(--info, #5b9bd5)', label: '已停止', pulse: false }, // 整個回合完成、你的回合
  idle: { color: 'var(--meta)', label: '未啟動', pulse: false }, // 無 AI session
};

const TOOL_LABEL: Record<AiTool, string> = { claude: 'Claude', codex: 'Codex' };

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
  // 每工具一個狀態（claude/codex），合併成一顆徽章：主視覺取最高優先態、tooltip 拆每工具。
  const [states, setStates] = useState<Partial<Record<AiTool, ClaudeState>>>({});

  useEffect(() => {
    ensureStyle();
    let alive = true;
    const unsub = ipc.events.claude.status((p) => {
      if (p.wsId !== wsId) return; // 只認本工作區的事件
      setStates((prev) => ({ ...prev, [p.tool]: p.status?.state ?? 'idle' }));
    });
    // 掛載補快照：main 只在變更時推事件，重掛後沒這步會一直空白到下次狀態變化。
    void ipc.claude
      .states()
      .then((snap) => {
        if (!alive) return;
        const seed: Partial<Record<AiTool, ClaudeState>> = {};
        for (const s of snap) if (s.wsId === wsId) seed[s.tool] = s.status?.state ?? 'idle';
        setStates((prev) => ({ ...seed, ...prev })); // 已到的事件比快照新 → prev 優先
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unsub(); // 卸載退訂，防 listener 洩漏
    };
  }, [wsId]);

  // 每工具一個 chip（dot 顏色/脈動＝狀態、文字＝工具名）分開顯示；只顯示非 idle 的工具，都 idle → 不顯示。
  const active = (Object.keys(TOOL_LABEL) as AiTool[]).filter((t) => (states[t] ?? 'idle') !== 'idle');
  if (active.length === 0) return <span aria-hidden="true" />;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {active.map((t) => {
        const v = VIEW[states[t] as ClaudeState];
        return (
          <span
            key={t}
            role="status"
            aria-label={`${TOOL_LABEL[t]} 狀態：${v.label}`}
            title={`${TOOL_LABEL[t]}：${v.label}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
          >
            <span className={`pdws-claude-dot${v.pulse ? ' is-pulse' : ''}`} style={{ background: v.color, color: v.color }} aria-hidden="true" />
            <span aria-hidden="true" style={{ fontSize: 'var(--text-xs)', color: v.color, whiteSpace: 'nowrap' }}>
              {TOOL_LABEL[t]}
            </span>
          </span>
        );
      })}
    </span>
  );
}
