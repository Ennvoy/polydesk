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
    const sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'working', ts: 1 }];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
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
    const sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'working', ts: 1 }]; // 殘留 working
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
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
    let sessions: SessionStatus[] = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'working', ts: 1 }];
    const notes: { wsId: string; name: string }[] = [];
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => sessions,
      watchFactory: noWatch,
      notifyAwait: (i) => notes.push(i),
    });
    await mon.recompute(); // running
    expect(notes).toHaveLength(0);
    sessions = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'awaiting', ts: 2 }];
    await mon.recompute(); // → stopped-await（待確認）
    expect(emitted.at(-1)?.status.state).toBe('stopped-await');
    expect(notes).toEqual([{ wsId: 'a', name: 'a' }]);
    sessions = [{ sessionId: 's1', cwd: 'C:/p/a', state: 'done', ts: 3 }];
    await mon.recompute(); // → done（不再推通知）
    expect(emitted.at(-1)?.status.state).toBe('done');
    expect(notes).toHaveLength(1);
  });

  it('讀 session 失敗 → 視為無 session（有 PTY 的工作區 idle，不崩潰）', async () => {
    const workspaces = { list: () => wsList([{ id: 'a', path: 'C:/p/a' }]) };
    const pty = { pidsOf: (): number[] => [100] };
    const emitted: StatusEvent[] = [];
    const mon = new ClaudeStatusMonitor(workspaces, pty, (p) => emitted.push(p), {
      readSessions: async () => {
        throw new Error('讀檔失敗');
      },
      watchFactory: noWatch,
    });
    await expect(mon.recompute()).resolves.toBeUndefined();
    expect(emitted.find((e) => e.wsId === 'a')).toBeUndefined(); // idle == 預設 → 不 emit、不崩潰
  });
});
