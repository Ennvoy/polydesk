// PE-2：跨工作區彙總 Claude 三態計數（status bar 總覽用）。訂閱 claude:status 事件累積每工作區狀態。
import { useEffect, useState } from 'react';
import { ipc } from '../ipc/client';
import type { ClaudeState } from '../../shared/types';

export interface ClaudeCounts {
  running: number;
  awaiting: number;
  idle: number;
}

export function useClaudeCounts(): ClaudeCounts {
  const [states, setStates] = useState<Record<string, ClaudeState>>({});
  useEffect(() => {
    return ipc.events.claude.status((p) => {
      setStates((prev) => ({ ...prev, [p.wsId]: p.status?.state ?? 'idle' }));
    });
  }, []);
  const vals = Object.values(states);
  return {
    running: vals.filter((s) => s === 'running').length,
    awaiting: vals.filter((s) => s === 'stopped-await').length,
    idle: vals.filter((s) => s === 'idle').length,
  };
}
