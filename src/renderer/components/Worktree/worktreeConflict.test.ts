// F-13 checkout 衝突解析單測（REQ-WT-005）。
import { describe, it, expect } from 'vitest';
import { parseWorktreeConflict } from './worktreeModel';

describe('parseWorktreeConflict', () => {
  it('已被其他 worktree 簽出 → isConflict + 抽出路徑', () => {
    const msg = "fatal: 'dev' is already checked out at 'C:/repos/app-worktrees/dev'";
    expect(parseWorktreeConflict(msg)).toEqual({ isConflict: true, path: 'C:/repos/app-worktrees/dev' });
  });

  it('already used by worktree 樣式', () => {
    const msg = "fatal: 'feat/x' is already used by worktree at '/home/u/app-worktrees/feat-x'";
    expect(parseWorktreeConflict(msg)).toEqual({ isConflict: true, path: '/home/u/app-worktrees/feat-x' });
  });

  it('衝突但無路徑 → isConflict:true, path:undefined', () => {
    expect(parseWorktreeConflict('already checked out')).toEqual({ isConflict: true, path: undefined });
  });

  it('非衝突錯誤（分支不存在等）→ isConflict:false', () => {
    expect(parseWorktreeConflict("error: pathspec 'x' did not match")).toEqual({ isConflict: false });
  });

  it('路徑含單引號（O\'Brien）不被截斷（紅軍 A2）', () => {
    const msg = "fatal: 'dev' is already checked out at 'C:/Users/O'Brien/wt'";
    expect(parseWorktreeConflict(msg)).toEqual({ isConflict: true, path: "C:/Users/O'Brien/wt" });
  });
});
