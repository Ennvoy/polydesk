// PE-2：跨工作區彙總 Claude 三態計數（status bar 總覽用）。掛載先拉 claude:states 快照補現況
//（main 只在變更時推事件，重掛後沒快照會漏算既有狀態），再訂閱 claude:status 事件累積。
import { useEffect, useState } from 'react';
import { ipc } from '../ipc/client';
import type { ClaudeState } from '../../shared/types';

export interface ClaudeCounts {
  running: number;
  awaiting: number;
  done: number;
  idle: number;
}

export function useClaudeCounts(): ClaudeCounts {
  const [states, setStates] = useState<Record<string, ClaudeState>>({});
  useEffect(() => {
    let alive = true;
    const unsub = ipc.events.claude.status((p) => {
      setStates((prev) => ({ ...prev, [`${p.wsId}::${p.tool}`]: p.status?.state ?? 'idle' }));
    });
    void ipc.claude
      .states()
      .then((snap) => {
        if (!alive) return;
        const seed: Record<string, ClaudeState> = {};
        for (const s of snap) seed[`${s.wsId}::${s.tool}`] = s.status?.state ?? 'idle';
        setStates((prev) => ({ ...seed, ...prev })); // 已到的事件比快照新 → prev 優先
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  const vals = Object.values(states);
  return {
    running: vals.filter((s) => s === 'running').length,
    awaiting: vals.filter((s) => s === 'stopped-await').length,
    done: vals.filter((s) => s === 'done').length,
    idle: vals.filter((s) => s === 'idle').length,
  };
}
