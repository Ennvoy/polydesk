// P-4 schema v2 遷移單測（REQ-PERSIST-004）：v0/v1 → v2 鏈、workspaces 保留、
// worktree 標記 round-trip、未來版本仍 throw。
import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrate, defaultState } from './schema';

describe('schema v2（worktree 欄位）', () => {
  it('CURRENT_SCHEMA_VERSION 已升到 2', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
  });

  it('v1 舊檔（無 worktree 欄位）→ v2：workspaces 原樣保留、不生 worktree 欄位', () => {
    const v1 = {
      schemaVersion: 1,
      theme: 'warm',
      workspaces: [
        { id: 'ws_1', name: 'app', path: 'C:/repos/app', order: 0, status: 'ok', defaultShell: 'powershell', trusted: true, profileDir: 'pw-profiles/ws_1' },
      ],
      layout: null,
      openFiles: [],
      terminals: [],
    };
    const out = migrate(v1);
    expect(out.schemaVersion).toBe(2);
    expect(out.theme).toBe('warm');
    expect(out.workspaces).toHaveLength(1);
    expect(out.workspaces[0].worktree).toBeUndefined();
  });

  it('v0（無版本欄位）→ v2 鏈式遷移成功', () => {
    const out = migrate({ theme: 'light', workspaces: [] });
    expect(out.schemaVersion).toBe(2);
    expect(out.theme).toBe('light');
  });

  it('v2 帶 worktree 標記 round-trip 保留', () => {
    const v2 = {
      ...defaultState(),
      workspaces: [
        { id: 'ws_2', name: 'feat-x', path: 'C:/repos/app-worktrees/feat-x', order: 0, status: 'ok', defaultShell: 'powershell', trusted: true, profileDir: 'pw-profiles/ws_2', worktree: { mainPath: 'C:/repos/app' } },
      ],
    };
    const out = migrate(v2);
    expect(out.workspaces[0].worktree).toEqual({ mainPath: 'C:/repos/app' });
  });

  it('未來版本（v3）仍 throw（備份壞檔＋預設啟動路徑）', () => {
    expect(() => migrate({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow();
  });
});
