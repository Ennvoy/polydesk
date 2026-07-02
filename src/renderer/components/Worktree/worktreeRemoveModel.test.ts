// F-12 移除決策單測（紅軍 A：dirty 繞過防護）。
import { describe, it, expect } from 'vitest';
import { planRemoval, confirmedDirtyRemoval } from './worktreeRemoveModel';

describe('planRemoval（REQ-WT-006/007）', () => {
  it('僅移出列表 → 不刪資料夾、不 force（不管 dirty）', () => {
    expect(planRemoval(false, 0)).toEqual({ action: 'remove', deleteFolder: false, force: false });
    expect(planRemoval(false, 5)).toEqual({ action: 'remove', deleteFolder: false, force: false });
  });

  it('連同刪除 + 乾淨 → 直接 remove、不 force', () => {
    expect(planRemoval(true, 0)).toEqual({ action: 'remove', deleteFolder: true, force: false });
  });

  it('連同刪除 + dirty → 需兩段確認（列變更數），不直接刪', () => {
    expect(planRemoval(true, 3)).toEqual({ action: 'confirm-dirty', changedCount: 3 });
  });

  it('兩段確認後 → 連同刪除 + force', () => {
    expect(confirmedDirtyRemoval()).toEqual({ action: 'remove', deleteFolder: true, force: true });
  });
});
