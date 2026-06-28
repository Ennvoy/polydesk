// F-8 ClaudeStatusMonitor 單元測試（真實樹演算法 + 注入受控程序清單 + fake PtyManager.pidsOf）。
// 覆蓋：三態分類正確、狀態不變不重複 emit、N 工作區單次列舉、間隔隨 N 放大且有界、
//       single-flight 不重入、逾時 backstop 不卡死、lifecycle 清快取。
// 紅軍 A4（single-flight + 逾時）、A5（間隔夾擠 + 同輪單快照）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import {
  ClaudeStatusMonitor,
  computePollInterval,
  classifyClaude,
} from './ClaudeStatusMonitor';
import type { ProcessInfo, ProcessLister } from './processProbe';
import type { EventChannels } from '../../shared/ipc';
import type { Workspace } from '../../shared/types';

type StatusEvent = EventChannels['claude:status'];

/** 最小 Workspace[]（只用到 id）。 */
function wsList(ids: string[]): Workspace[] {
  return ids.map((id, i) => ({
    id,
    name: id,
    path: `C:\\ws\\${id}`,
    order: i,
    status: 'ok' as const,
    defaultShell: 'powershell' as const,
    trusted: true,
    profileDir: `pw/${id}`,
    hydrated: true,
  }));
}

function ptyFromMap(map: Record<string, number[]>, log?: string[]) {
  return {
    pidsOf: (id: string): number[] => {
      log?.push(id);
      return map[id] ?? [];
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ClaudeStatusMonitor — 三態分類 + 變才 emit', () => {
  it('idle/running/stopped-await 正確；idle 首輪不空打、running 帶 pid', async () => {
    vi.useFakeTimers();
    const workspaces = { list: () => wsList(['ws1', 'ws2', 'ws3']) };
    const pty = ptyFromMap({ ws1: [100], ws2: [200], ws3: [300] });
    const procs: ProcessInfo[] = [
      { pid: 100, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 101, ppid: 100, name: 'node.exe', cmd: 'node s.js' }, // ws1: 無 claude → idle
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 201, ppid: 200, name: 'claude.exe', cmd: 'claude.exe' },
      { pid: 202, ppid: 201, name: 'rg.exe', cmd: 'rg foo' }, // ws2: claude+子 → running
      { pid: 300, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 301, ppid: 300, name: 'claude.exe', cmd: 'claude.exe' }, // ws3: claude 無子 → stopped-await
    ];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), async () => procs, {
      basePollMs: 5000,
      probeTimeoutMs: 30000,
    });
    mon.start();
    await vi.advanceTimersByTimeAsync(1);
    mon.stop();

    const byWs = Object.fromEntries(emitted.map((e) => [e.wsId, e.status.state]));
    expect(byWs).toEqual({ ws2: 'running', ws3: 'stopped-await' });
    expect(emitted.find((e) => e.wsId === 'ws1')).toBeUndefined(); // idle == 預設 → 不 emit
    expect(emitted.find((e) => e.wsId === 'ws2')?.status.pid).toBe(201);
  });
});

describe('ClaudeStatusMonitor — 去抖（狀態不變不重複 emit，REQ-MON-006）', () => {
  it('連續多輪相同狀態只 emit 一次', async () => {
    vi.useFakeTimers();
    const procs: ProcessInfo[] = [
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 201, ppid: 200, name: 'claude.exe', cmd: 'claude.exe' },
      { pid: 202, ppid: 201, name: 'rg.exe', cmd: 'rg foo' },
    ];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(
      { list: () => wsList(['ws2']) },
      ptyFromMap({ ws2: [200] }),
      (p) => emitted.push(p),
      async () => procs,
      { basePollMs: 5000, probeTimeoutMs: 30000 },
    );
    mon.start();
    await vi.advanceTimersByTimeAsync(1); // round1 → running
    await vi.advanceTimersByTimeAsync(5000); // round2 同
    await vi.advanceTimersByTimeAsync(5000); // round3 同
    mon.stop();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].status.state).toBe('running');
  });
});

describe('ClaudeStatusMonitor — 資源有界（N 工作區單次列舉，REQ-MON-006）', () => {
  it('一輪只列舉一次（不每工作區各 spawn 一次）', async () => {
    vi.useFakeTimers();
    let listCalls = 0;
    const lister: ProcessLister = async () => {
      listCalls += 1;
      return [];
    };
    const mon = new ClaudeStatusMonitor(
      { list: () => wsList(['a', 'b', 'c', 'd', 'e']) },
      ptyFromMap({}),
      () => {},
      lister,
      { basePollMs: 5000, probeTimeoutMs: 30000 },
    );
    mon.start();
    await vi.advanceTimersByTimeAsync(1);
    mon.stop();
    expect(listCalls).toBe(1);
  });
});

describe('computePollInterval — 自適應且有界（F-8-A5）', () => {
  it('n=0 → base（非 0ms 忙迴圈）、n=1 → base、n 極大 → 夾在硬上限', () => {
    expect(computePollInterval(0, 5000, 60000, 4)).toBe(5000);
    expect(computePollInterval(1, 5000, 60000, 4)).toBe(5000);
    expect(computePollInterval(8, 5000, 60000, 4)).toBe(10000);
    expect(computePollInterval(10000, 5000, 60000, 4)).toBe(60000);
    for (const n of [0, 1, 2, 5, 10, 100, 10000]) {
      const v = computePollInterval(n, 5000, 60000, 4);
      expect(v).toBeGreaterThanOrEqual(5000);
      expect(v).toBeLessThanOrEqual(60000);
    }
  });

  it('非有限 / 負數 n 退回 base（不退化成 0）', () => {
    expect(computePollInterval(NaN, 5000, 60000, 4)).toBe(5000);
    expect(computePollInterval(-5, 5000, 60000, 4)).toBe(5000);
    expect(computePollInterval(Infinity, 5000, 60000, 4)).toBe(5000);
  });
});

describe('ClaudeStatusMonitor — 間隔隨 N 放大（整合驗證）', () => {
  it('5 工作區 → 下一輪間隔 = base*ceil(5/4)=2×base', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const lister: ProcessLister = async () => {
      calls += 1;
      return [];
    };
    const mon = new ClaudeStatusMonitor(
      { list: () => wsList(['a', 'b', 'c', 'd', 'e']) },
      ptyFromMap({}),
      () => {},
      lister,
      { basePollMs: 5000, maxPollMs: 60000, scaleK: 4, probeTimeoutMs: 30000 },
    );
    mon.start();
    await vi.advanceTimersByTimeAsync(1); // round1
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(9000); // < 10000 間隔 → 尚未第二輪
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); // 補滿 10000 → 第二輪
    expect(calls).toBe(2);
    mon.stop();
  });
});

describe('ClaudeStatusMonitor — single-flight + 逾時 backstop（F-8-A4）', () => {
  it('永不 resolve 的 lister：逾時 backstop 放棄該輪、不 emit、迴圈不卡死', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const lister: ProcessLister = () => {
      calls += 1;
      return new Promise<ProcessInfo[]>(() => {}); // 永不 resolve
    };
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(
      { list: () => wsList(['ws1']) },
      ptyFromMap({ ws1: [1] }),
      (p) => emitted.push(p),
      lister,
      { basePollMs: 5000, probeTimeoutMs: 1000 },
    );
    mon.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); // backstop 觸發 → 放棄、沿用上次
    expect(emitted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000); // 仍排下一輪（不卡死）
    expect(calls).toBe(2);
    mon.stop();
  });

  it('上一輪未完成不重入：任一時刻最多 1 個 probe', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    let resolveCurrent: ((v: ProcessInfo[]) => void) | null = null;
    const lister: ProcessLister = () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<ProcessInfo[]>((res) => {
        resolveCurrent = (v) => {
          active -= 1;
          res(v);
        };
      });
    };
    const mon = new ClaudeStatusMonitor(
      { list: () => wsList(['ws1']) },
      ptyFromMap({}),
      () => {},
      lister,
      { basePollMs: 5000, probeTimeoutMs: 60000 },
    );
    mon.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
    // 時間跨越數個間隔，但上一輪仍 in-flight → 不重入
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls).toBe(1);
    expect(maxActive).toBe(1);
    // 完成本輪 → 下一輪才排程
    resolveCurrent!([]);
    await vi.advanceTimersByTimeAsync(0); // settle 完成 + 排程
    await vi.advanceTimersByTimeAsync(5000); // 觸發下一輪
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    mon.stop();
  });
});

describe('ClaudeStatusMonitor — 同輪單快照（F-8-A5：防 PID 回收誤歸戶）', () => {
  it('N 工作區共用一次列舉快照、各取一次 root pids（不二次 spawn）', async () => {
    vi.useFakeTimers();
    let listCalls = 0;
    const snapshot: ProcessInfo[] = [
      { pid: 100, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 101, ppid: 100, name: 'claude.exe', cmd: 'claude.exe' },
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
    ];
    const lister: ProcessLister = async () => {
      listCalls += 1;
      return snapshot;
    };
    const pidsLog: string[] = [];
    const pty = ptyFromMap({ ws1: [100], ws2: [200] }, pidsLog);
    const mon = new ClaudeStatusMonitor(
      { list: () => wsList(['ws1', 'ws2']) },
      pty,
      () => {},
      lister,
      { basePollMs: 5000, probeTimeoutMs: 30000 },
    );
    mon.start();
    await vi.advanceTimersByTimeAsync(1);
    mon.stop();
    expect(listCalls).toBe(1); // 同輪單一快照供所有工作區比對
    expect(pidsLog.sort()).toEqual(['ws1', 'ws2']); // 每 ws 各取一次 root pids
  });
});

describe('ClaudeStatusMonitor — lifecycle 清快取', () => {
  it('teardown(wsId) 清狀態快取：移除後相同狀態仍視為新狀態再 emit', async () => {
    vi.useFakeTimers();
    const lifecycle = new WorkspaceLifecycle();
    const procs: ProcessInfo[] = [
      { pid: 200, ppid: 1, name: 'powershell.exe', cmd: 'powershell.exe' },
      { pid: 201, ppid: 200, name: 'claude.exe', cmd: 'claude.exe' },
      { pid: 202, ppid: 201, name: 'rg.exe', cmd: 'rg foo' },
    ];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(
      { list: () => wsList(['ws2']) },
      ptyFromMap({ ws2: [200] }),
      (p) => emitted.push(p),
      async () => procs,
      { basePollMs: 5000, probeTimeoutMs: 30000, lifecycle },
    );
    mon.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(emitted.map((e) => e.status.state)).toEqual(['running']);
    await vi.advanceTimersByTimeAsync(5000); // 同狀態 → 去抖
    expect(emitted).toHaveLength(1);

    await lifecycle.teardown('ws2'); // 清該 ws 快取
    await vi.advanceTimersByTimeAsync(5000); // 快取空 → 視為新狀態再 emit
    expect(emitted).toHaveLength(2);
    expect(emitted[1].status.state).toBe('running');
    mon.stop();
  });
});

describe('classifyClaude — 純函式', () => {
  it('三態映射', () => {
    expect(classifyClaude([], false)).toBe('idle');
    expect(classifyClaude([1], true)).toBe('running');
    expect(classifyClaude([1], false)).toBe('stopped-await');
  });
});
