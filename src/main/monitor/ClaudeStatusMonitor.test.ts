// ClaudeStatusMonitor（hook 版）單測：注入 readSessions + no-op watch，直接呼 recompute 驗證
// 聚合（cwd→工作區）、pidsOf 閘門（關終端機→idle）、變才 emit、running→待確認 通知。
import { describe, it, expect } from 'vitest';
import { ClaudeStatusMonitor } from './ClaudeStatusMonitor';
import type { EventChannels } from '../../shared/ipc';
import type { Workspace } from '../../shared/types';
import type { SessionStatus } from './claudeHookState';

type StatusEvent = EventChannels['claude:status'];

function wsList(specs: { id: string; path: string }[]): Workspace[] {
  return specs.map((s, i) => ({
    id: s.id,
    name: s.id,
    path: s.path,
    order: i,
    status: 'ok' as const,
    defaultShell: 'powershell' as const,
    trusted: true,
    profileDir: `pw/${s.id}`,
    hydrated: true,
  }));
}

const noWatch = (): { close: () => void } => ({ close: () => undefined });

describe('ClaudeStatusMonitor（hook 版）', () => {
  it('聚合 hook 狀態 → 變才 emit（有 PTY 無 session = idle 不空打）', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }, { id: 'b', path: 'C:/p/b' }]) };
    const pty = { pidsOf: (id: string): number[] => (id === 'a' || id === 'b' ? [100] : []) };
    const sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'working', ts: Date.now() }];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => ({ claude: new Set([100]), codex: new Set<number>(), agy: new Set<number>() }), // 對應 pidsOf 回的 100 → claude process 判定為在跑
      watchFactory: noWatch,
    });
    await mon.recompute();
    expect(emitted.find((e) => e.wsId === 'a')?.status.state).toBe('running');
    expect(emitted.find((e) => e.wsId === 'b')).toBeUndefined(); // 有 PTY 但無 session → idle == 預設 → 不 emit
  });

  it('關掉終端機（無 alive PTY）→ idle，即使 hook 狀態殘留 working', async () => {
    let pids: Record<string, number[]> = { a: [100] };
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (id: string): number[] => pids[id] ?? [] };
    const sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'working', ts: Date.now() }]; // 殘留 working
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => ({ claude: new Set([100]), codex: new Set<number>(), agy: new Set<number>() }), // 對應 pidsOf 回的 100 → claude process 判定為在跑
      watchFactory: noWatch,
    });
    await mon.recompute();
    expect(emitted.at(-1)?.status.state).toBe('running');
    pids = {}; // 終端機關閉
    await mon.recompute();
    expect(emitted.at(-1)?.status.state).toBe('idle'); // pidsOf 閘門蓋過殘留
  });

  it('running→stopped-await（待確認）推一次通知；done 不推', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [100] };
    let sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'working', ts: Date.now() }];
    const notes: { wsId: string; name: string; tool: 'claude' | 'codex' | 'agy' }[] = [];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => ({ claude: new Set([100]), codex: new Set<number>(), agy: new Set<number>() }), // 對應 pidsOf 回的 100 → claude process 判定為在跑
      watchFactory: noWatch,
      notifyAwait: (i) => notes.push(i),
    });
    await mon.recompute(); // running
    expect(notes).toHaveLength(0);
    sessions = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'awaiting', ts: Date.now() }];
    await mon.recompute(); // → stopped-await（待確認）
    expect(emitted.at(-1)?.status.state).toBe('stopped-await');
    expect(notes).toEqual([{ wsId: 'a', name: 'a', tool: 'claude' }]);
    sessions = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'done', ts: 3 }];
    await mon.recompute(); // → done（不再推通知）
    expect(emitted.at(-1)?.status.state).toBe('done');
    expect(notes).toHaveLength(1);
  });

  it('process 掃描失敗（回 null）→ 保留上次 pid 快取，不把在跑的打回 idle（防徽章閃爍）', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [100] };
    const sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'working', ts: Date.now() }];
    let scanOk = true;
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => (scanOk ? { claude: new Set([100]), codex: new Set<number>(), agy: new Set<number>() } : null), // 之後掃描失敗（wmic 缺 + PowerShell 逾時）
      processScanMs: 0, // 每次 recompute 都掃（測試用）
      watchFactory: noWatch,
    });
    await mon.recompute();
    expect(emitted.at(-1)?.status.state).toBe('running');
    scanOk = false; // 掃描開始失敗
    await mon.recompute();
    await mon.recompute();
    // fail-open：快取保留 → 仍 running，不 emit idle
    expect(emitted.filter((e) => e.wsId === 'a' && e.status.state === 'idle')).toHaveLength(0);
    expect(emitted.at(-1)?.status.state).toBe('running');
  });

  it('snapshot()：回目前所有已知（工作區×工具）狀態（掛載快照用）', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [100] };
    const sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'done', ts: Date.now() }];
    const mon = new ClaudeStatusMonitor(workspaces, pty, () => undefined, {
      readSessions: async () => sessions,
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => ({ claude: new Set([100]), codex: new Set<number>(), agy: new Set<number>() }),
      watchFactory: noWatch,
    });
    expect(mon.snapshot()).toEqual([]); // 尚未重算 → 空
    await mon.recompute();
    const snap = mon.snapshot();
    expect(snap).toContainEqual({ wsId: 'a', tool: 'claude', status: { state: 'done' } });
  });

  it('新 session 但 pid 快取沒它 → 強制補掃一次（加快剛啟動→燈亮），每 session 最多一次', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [100] };
    let sessions: SessionStatus[] = [];
    let scanPids = new Set<number>(); // 一開始掃不到 claude
    let scanCount = 0;
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => {
        scanCount += 1;
        return { claude: new Set(scanPids), codex: new Set<number>(), agy: new Set<number>() };
      },
      processScanMs: 1e9, // 一般節流關死 → 只有冷啟動第一掃 + 強制補掃會跑
      forceScanMinMs: 0,
      watchFactory: noWatch,
    });
    await mon.recompute(); // 冷啟動掃 #1（無 session、無 pid）
    expect(scanCount).toBe(1);
    // claude 剛啟動：hook 寫了新 session，但 pid 快取還沒它
    scanPids = new Set([100]);
    sessions = [{ sessionId: 's-new', cwd: 'C:/p/a', state: 'working', ts: Date.now() }];
    await mon.recompute(); // 觸發強制補掃 #2
    expect(scanCount).toBe(2);
    await new Promise((r) => setTimeout(r, 0)); // 等背景掃描結果觸發的重算
    expect(emitted.at(-1)?.status.state).toBe('running');
    const after = scanCount;
    await mon.recompute(); // 同 session 不再重複強制掃
    expect(scanCount).toBe(after);
  });

  it('讀 session 失敗 → 視為無 session（有 PTY 的工作區 idle，不崩潰）', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [100] };
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => {
        throw new Error('讀檔失敗');
      },
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => ({ claude: new Set([100]), codex: new Set<number>(), agy: new Set<number>() }), // 對應 pidsOf 回的 100 → claude process 判定為在跑
      watchFactory: noWatch,
    });
    await expect(mon.recompute()).resolves.toBeUndefined();
    expect(emitted.find((e) => e.wsId === 'a')).toBeUndefined(); // idle == 預設 → 不 emit、不崩潰
  });

  it('Agy 程序存在但尚未送任務 → done；log 可切 running/awaiting/done；程序離開 → idle', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [300] };
    let agyPids = new Set([300]);
    let agySessions: SessionStatus[] = [];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => [],
      readCodex: async () => [],
      readAgy: async () => agySessions,
      scanPids: async () => ({ claude: new Set<number>(), codex: new Set<number>(), agy: new Set(agyPids) }),
      processScanMs: 0,
      watchFactory: noWatch,
    });
    await mon.recompute();
    expect(emitted).toContainEqual({ wsId: 'a', tool: 'agy', status: { state: 'done' } });

    agySessions = [{ sessionId: 'agy-1', cwd: 'C:/p/a', state: 'working', ts: Date.now(), tool: 'agy' }];
    await mon.recompute();
    expect(emitted.at(-1)).toEqual({ wsId: 'a', tool: 'agy', status: { state: 'running' } });
    agySessions = [{ sessionId: 'agy-1', cwd: 'C:/p/a', state: 'awaiting', ts: Date.now(), tool: 'agy' }];
    await mon.recompute();
    expect(emitted.at(-1)).toEqual({ wsId: 'a', tool: 'agy', status: { state: 'stopped-await' } });
    agySessions = [{ sessionId: 'agy-1', cwd: 'C:/p/a', state: 'done', ts: Date.now(), tool: 'agy' }];
    await mon.recompute();
    expect(emitted.at(-1)).toEqual({ wsId: 'a', tool: 'agy', status: { state: 'done' } });

    agyPids = new Set();
    await mon.recompute();
    await mon.recompute();
    expect(emitted.at(-1)).toEqual({ wsId: 'a', tool: 'agy', status: { state: 'idle' } });
  });

  it('Codex 程序存在但 rollout 尚無任務活動 → done，不誤標 running', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [400] };
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => [],
      readCodex: async () => [],
      readAgy: async () => [],
      scanPids: async () => ({ claude: new Set<number>(), codex: new Set([400]), agy: new Set<number>() }),
      watchFactory: noWatch,
    });
    await mon.recompute();
    expect(emitted).toContainEqual({ wsId: 'a', tool: 'codex', status: { state: 'done' } });
  });
});
