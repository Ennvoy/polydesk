// F-13 跳轉解析單測（紅軍 A3：不切到已刪/失效或主工作樹）。
import { describe, it, expect } from 'vitest';
import { resolveJumpTarget } from './worktreeModel';

const wt = (path: string, extra: Partial<{ managedWsId: string; isMain: boolean; prunable: boolean }> = {}) => ({
  path,
  isMain: false,
  prunable: false,
  ...extra,
});

describe('resolveJumpTarget', () => {
  it('已納管且可切 → switch', () => {
    const list = [wt('C:/repos/app', { isMain: true }), wt('C:/repos/app-worktrees/dev', { managedWsId: 'ws_x' })];
    expect(resolveJumpTarget(list, 'C:/repos/app-worktrees/dev')).toEqual({ action: 'switch', wsId: 'ws_x' });
  });

  it('已納管但 prunable（資料夾已刪）→ prune-or-warn，不 switch（A3）', () => {
    const list = [wt('C:/repos/app-worktrees/dev', { managedWsId: 'ws_x', prunable: true })];
    expect(resolveJumpTarget(list, 'C:/repos/app-worktrees/dev')).toEqual({ action: 'prune-or-warn' });
  });

  it('已納管但 isMain → 不 switch', () => {
    const list = [wt('C:/repos/app', { managedWsId: 'ws_m', isMain: true })];
    expect(resolveJumpTarget(list, 'C:/repos/app')).toEqual({ action: 'prune-or-warn' });
  });

  it('未納管且有效 → adopt', () => {
    const list = [wt('C:/repos/app-worktrees/ext')];
    expect(resolveJumpTarget(list, 'C:/repos/app-worktrees/ext')).toEqual({ action: 'adopt' });
  });

  it('未納管但 prunable → prune-or-warn（不 adopt 已刪路徑）', () => {
    const list = [wt('C:/repos/app-worktrees/gone', { prunable: true })];
    expect(resolveJumpTarget(list, 'C:/repos/app-worktrees/gone')).toEqual({ action: 'prune-or-warn' });
  });

  it('斜線方向差異仍配對（git / vs node \\）', () => {
    const list = [wt('C:/repos/app-worktrees/dev', { managedWsId: 'ws_x' })];
    expect(resolveJumpTarget(list, 'C:\\repos\\app-worktrees\\dev')).toEqual({ action: 'switch', wsId: 'ws_x' });
  });

  it('找不到 → not-found', () => {
    expect(resolveJumpTarget([], 'C:/x')).toEqual({ action: 'not-found' });
  });
});
