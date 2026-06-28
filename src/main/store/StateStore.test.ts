import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from './StateStore';
import { CURRENT_SCHEMA_VERSION, defaultState } from './schema';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'polydesk-store-'));
  file = join(dir, 'state.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('StateStore', () => {
  it('首次載入寫出含 schemaVersion 的預設狀態', () => {
    const store = new StateStore(file);
    const state = store.load();
    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(existsSync(file)).toBe(true);
  });

  it('原子寫後另一實例讀回一致（round-trip）', () => {
    const store = new StateStore(file);
    store.load();
    store.setTheme('warm');
    store.setWindowBounds({ width: 1024, height: 768, x: 10, y: 20 });

    const reopened = new StateStore(file);
    const state = reopened.load();
    expect(state.theme).toBe('warm');
    expect(state.windowBounds).toEqual({ width: 1024, height: 768, x: 10, y: 20 });
  });

  it('故意寫壞檔 → 偵測到 → 備份 + 回預設、不丟例外', () => {
    writeFileSync(file, '{ 這不是合法 json ', 'utf-8');
    const store = new StateStore(file);

    let state!: ReturnType<typeof store.load>;
    expect(() => {
      state = store.load();
    }).not.toThrow();

    expect(state.theme).toBe(defaultState().theme);
    expect(state.workspaces).toEqual([]);

    const backups = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(backups.length).toBe(1);
  });

  it('export → import round-trip 狀態一致', () => {
    const store = new StateStore(file);
    store.load();
    store.setTheme('light');
    store.setWindowBounds({ width: 1000, height: 700 });
    const exported = store.exportJson();

    const file2 = join(dir, 'state2.json');
    const store2 = new StateStore(file2);
    store2.load();
    const result = store2.importJson(exported);

    expect(result).toEqual({ ok: true });
    expect(store2.getAll()).toEqual(store.getAll());
  });

  it('import 非法 JSON 回明確錯誤、不破壞現狀', () => {
    const store = new StateStore(file);
    store.load();
    store.setTheme('warm');
    const before = store.getAll();

    const result = store.importJson('{ broken');
    expect('error' in result).toBe(true);
    expect(store.getAll()).toEqual(before);
  });

  it('未知舊 schemaVersion 走遷移到 current 並保留資料', () => {
    const legacy = {
      schemaVersion: 0,
      theme: 'warm',
      workspaces: [
        {
          id: 'w1',
          name: 'proj',
          path: 'C:/code/proj',
          order: 0,
          status: 'ok',
          defaultShell: 'powershell',
          trusted: true,
          profileDir: 'pw-profiles/w1',
        },
      ],
    };
    writeFileSync(file, JSON.stringify(legacy), 'utf-8');

    const store = new StateStore(file);
    const state = store.load();

    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(state.theme).toBe('warm');
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].id).toBe('w1');
    // 遷移後應寫回升級形態
    const reopened = new StateStore(file).load();
    expect(reopened.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('未來版本（> current）視為損毀，備份 + 回預設', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 9999, theme: 'light' }), 'utf-8');
    const store = new StateStore(file);
    const state = store.load();
    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(state.theme).toBe(defaultState().theme);
    const backups = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(backups.length).toBe(1);
  });
});
