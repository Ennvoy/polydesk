// claudeHookState 聚合純函式測試：cwd→工作區（最長前綴）、綜合優先序、無 PTY→idle。
import { describe, it, expect } from 'vitest';
import {
  hookStateToClaude,
  matchWorkspace,
  computeWorkspaceState,
  aggregateWorkspaceStates,
  type SessionStatus,
} from './claudeHookState';

const S = (over: Partial<SessionStatus>): SessionStatus => ({
  sessionId: 's',
  cwd: 'C:/proj/a',
  state: 'working',
  ts: 1,
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
});
