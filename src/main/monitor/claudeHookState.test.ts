// claudeHookState 聚合純函式測試：cwd→工作區（最長前綴）、綜合優先序、無 PTY→idle。
import { describe, it, expect } from 'vitest';
import {
  hookStateToClaude,
  matchWorkspace,
  computeWorkspaceState,
  aggregateWorkspaceStates,
  aggregateByTool,
  type SessionStatus,
} from './claudeHookState';

const S = (over: Partial<SessionStatus>): SessionStatus => ({
  sessionId: 's',
  cwd: 'C:/proj/a',
  state: 'working',
  ts: Date.now(), // 預設新鮮（避免誤觸 working 殘留時效保險）
  ...over,
});

describe('claudeHookState', () => {
  it('hookStateToClaude 對應四態', () => {
    expect(hookStateToClaude('working')).toBe('running');
    expect(hookStateToClaude('awaiting')).toBe('stopped-await');
    expect(hookStateToClaude('done')).toBe('done');
    expect(hookStateToClaude('???')).toBe('idle');
  });

  it('matchWorkspace：最長前綴勝、大小寫/斜線不敏感、子目錄歸戶、無對應回 null', () => {
    const wss = [
      { id: 'a', path: 'C:\\proj\\a' },
      { id: 'ab', path: 'C:\\proj\\a\\b' }, // 更長
    ];
    expect(matchWorkspace('C:/proj/a', wss)).toBe('a');
    expect(matchWorkspace('c:/PROJ/a/src/x', wss)).toBe('a'); // 大小寫不敏感 + 子目錄
    expect(matchWorkspace('C:/proj/a/b/deep', wss)).toBe('ab'); // 最長前綴勝
    expect(matchWorkspace('C:/other', wss)).toBeNull();
  });

  it('computeWorkspaceState：無 PTY→idle；有 PTY 取最高優先序；無 session→idle', () => {
    expect(computeWorkspaceState(false, [S({ state: 'working' })])).toBe('idle'); // 無 PTY 蓋過 hook 殘留
    expect(computeWorkspaceState(true, [])).toBe('idle');
    expect(computeWorkspaceState(true, [S({ state: 'done' })])).toBe('done');
    expect(computeWorkspaceState(true, [S({ state: 'done' }), S({ state: 'awaiting' })])).toBe('stopped-await');
    expect(computeWorkspaceState(true, [S({ state: 'done' }), S({ state: 'working' }), S({ state: 'awaiting' })])).toBe('running');
  });

  it('computeWorkspaceState：working/awaiting 殘留超時 → 忽略（避免舊 session 污染；done/ts=0 不受影響）', () => {
    const now = 100 * 60 * 1000; // 100 分鐘
    expect(computeWorkspaceState(true, [S({ state: 'working', ts: now - 1000 })], now)).toBe('running'); // 新鮮 → 執行中
    expect(computeWorkspaceState(true, [S({ state: 'working', ts: now - 60 * 60 * 1000 })], now)).toBe('idle'); // 殘留忽略 → 無有效 session → idle
    expect(computeWorkspaceState(true, [S({ state: 'awaiting', ts: now - 60 * 60 * 1000 })], now)).toBe('idle'); // 待確認殘留也忽略
    // 舊 awaiting 殘留 + 新鮮 working → 執行中（殘留不污染成待確認）
    expect(computeWorkspaceState(true, [S({ state: 'awaiting', ts: now - 60 * 60 * 1000 }), S({ state: 'working', ts: now - 1000 })], now)).toBe('running');
    expect(computeWorkspaceState(true, [S({ state: 'done', ts: now - 60 * 60 * 1000 })], now)).toBe('done'); // done 不過濾
    expect(computeWorkspaceState(true, [S({ state: 'working', ts: 0 })], now)).toBe('running'); // ts=0（未知）不過濾
  });

  it('aggregateWorkspaceStates：每 session 歸戶 + 逐工作區綜合 + PTY 閘門', () => {
    const wss = [
      { id: 'a', path: 'C:/proj/a' },
      { id: 'b', path: 'C:/proj/b' },
      { id: 'c', path: 'C:/proj/c' },
    ];
    const sessions = [
      S({ sessionId: 's1', cwd: 'C:/proj/a', state: 'working' }),
      S({ sessionId: 's2', cwd: 'C:/proj/b/sub', state: 'awaiting' }),
      S({ sessionId: 's3', cwd: 'C:/nowhere', state: 'working' }), // 不歸任何工作區
    ];
    // a/b 有 PTY；c 無 PTY（即使有殘留也 idle）。
    const alive = (id: string): boolean => id === 'a' || id === 'b';
    const out = aggregateWorkspaceStates(wss, sessions, alive);
    expect(out.get('a')).toBe('running');
    expect(out.get('b')).toBe('stopped-await'); // 子目錄歸戶到 b
    expect(out.get('c')).toBe('idle');
  });

  it('aggregateByTool：每工作區×工具各算狀態（cwd 歸戶 + tool 分組）', () => {
    const wss = [
      { id: 'a', path: 'C:/proj/a' },
      { id: 'b', path: 'C:/proj/b' },
    ];
    const now = Date.now();
    const sessions: SessionStatus[] = [
      { sessionId: 'c1', cwd: 'C:/proj/a', state: 'working', ts: now, tool: 'claude' },
      { sessionId: 'x1', cwd: 'C:/proj/a', state: 'done', ts: now, tool: 'codex' },
      { sessionId: 'c2', cwd: 'C:/proj/b', state: 'awaiting', ts: now, tool: 'claude' },
    ];
    const out = aggregateByTool(wss, sessions, () => true, now);
    expect(out.get('a')?.get('claude')).toBe('running');
    expect(out.get('a')?.get('codex')).toBe('done');
    expect(out.get('b')?.get('claude')).toBe('stopped-await');
    expect(out.get('b')?.get('codex')).toBe('idle'); // b 無 codex session
  });

  it('aggregateByTool：無 alive PTY → 該工作區所有工具 idle；tool undefined 視為 claude', () => {
    const wss = [{ id: 'a', path: 'C:/proj/a' }];
    const now = Date.now();
    const sessions: SessionStatus[] = [
      { sessionId: 'c1', cwd: 'C:/proj/a', state: 'working', ts: now }, // 無 tool → claude
      { sessionId: 'x1', cwd: 'C:/proj/a', state: 'working', ts: now, tool: 'codex' },
    ];
    expect(aggregateByTool(wss, sessions, () => false, now).get('a')?.get('claude')).toBe('idle');
    expect(aggregateByTool(wss, sessions, () => false, now).get('a')?.get('codex')).toBe('idle');
    expect(aggregateByTool(wss, sessions, () => true, now).get('a')?.get('claude')).toBe('running'); // undefined→claude
  });
});
