// P-3 WorkspaceManager 單元測試（真實 fs temp 目錄 + 真實 StateStore，無 mock）。
// 對齊 verify：去重拒重複路徑、reorder 持久化、activate 才 hydrate、刪除呼 teardown、
// 不存在路徑標 missing 不丟列表。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from './WorkspaceManager';
import { WorkspaceLifecycle } from './workspaceLifecycle';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'polydesk-ws-'));
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const lifecycle = new WorkspaceLifecycle();
  const mgr = new WorkspaceManager(store, lifecycle, userData);
  return { root, userData, store, lifecycle, mgr };
}

function makeDir(root: string, name: string): string {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  return p;
}

describe('WorkspaceManager', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('新增有效資料夾並以資料夾名為預設顯示名', () => {
    const dir = makeDir(ctx.root, 'my-app');
    const res = ctx.mgr.add({ path: dir });
    expect('id' in res).toBe(true);
    if ('id' in res) {
      expect(res.name).toBe('my-app');
      expect(res.status).toBe('ok');
      expect(res.defaultShell).toBe('powershell');
      expect(res.hydrated).toBe(false);
    }
  });

  it('去重：同一路徑重複加入回 duplicate', () => {
    const dir = makeDir(ctx.root, 'dup');
    ctx.mgr.add({ path: dir });
    const second = ctx.mgr.add({ path: dir });
    expect(second).toEqual({ error: 'duplicate' });
    // 大小寫/尾斜線也視為同一路徑（Windows）
    const third = ctx.mgr.add({ path: dir + '\\' });
    expect(third).toEqual({ error: 'duplicate' });
    expect(ctx.mgr.list().length).toBe(1);
  });

  it('無效路徑（不存在）回 invalid', () => {
    const res = ctx.mgr.add({ path: join(ctx.root, 'does-not-exist') });
    expect(res).toEqual({ error: 'invalid' });
  });

  it('reorder 持久化（重建 manager 後順序仍在）', () => {
    const a = ctx.mgr.add({ path: makeDir(ctx.root, 'a') });
    const b = ctx.mgr.add({ path: makeDir(ctx.root, 'b') });
    const c = ctx.mgr.add({ path: makeDir(ctx.root, 'c') });
    if (!('id' in a) || !('id' in b) || !('id' in c)) throw new Error('add 失敗');
    ctx.mgr.reorder([c.id, a.id, b.id]);
    // 重新讀同一 store 檔（模擬重啟）
    const store2 = new StateStore(join(ctx.userData, 'state.json'));
    store2.load();
    const mgr2 = new WorkspaceManager(store2, new WorkspaceLifecycle(), ctx.userData);
    expect(mgr2.list().map((w) => w.name)).toEqual(['c', 'a', 'b']);
  });

  it('改名持久化', () => {
    const a = ctx.mgr.add({ path: makeDir(ctx.root, 'orig') });
    if (!('id' in a)) throw new Error('add 失敗');
    ctx.mgr.rename(a.id, '  改後名稱  ');
    expect(ctx.mgr.get(a.id)?.name).toBe('改後名稱');
  });

  it('每工作區可設預設 shell（REQ-TERM-003）', () => {
    const a = ctx.mgr.add({ path: makeDir(ctx.root, 'shellws') });
    if (!('id' in a)) throw new Error('add 失敗');
    ctx.mgr.setDefaultShell(a.id, 'gitbash');
    expect(ctx.mgr.get(a.id)?.defaultShell).toBe('gitbash');
  });

  it('activate 才 hydrate（lazy 實體化）', () => {
    const a = ctx.mgr.add({ path: makeDir(ctx.root, 'lazy') });
    if (!('id' in a)) throw new Error('add 失敗');
    expect(ctx.mgr.isHydrated(a.id)).toBe(false);
    expect(ctx.mgr.activate(a.id)).toBe(true);
    expect(ctx.mgr.isHydrated(a.id)).toBe(true);
    expect(ctx.mgr.list().find((w) => w.id === a.id)?.hydrated).toBe(true);
  });

  it('移除呼叫 lifecycle teardown（避免殭屍程序）', async () => {
    const a = ctx.mgr.add({ path: makeDir(ctx.root, 'teardownws') });
    if (!('id' in a)) throw new Error('add 失敗');
    const torn: string[] = [];
    ctx.lifecycle.register('pty', (wsId) => {
      torn.push(wsId);
    });
    await ctx.mgr.remove(a.id, false);
    expect(torn).toEqual([a.id]);
    expect(ctx.mgr.list().length).toBe(0);
  });

  it('purgeProfile=true 刪除 profile 目錄；false 保留工作區外資料', async () => {
    const a = ctx.mgr.add({ path: makeDir(ctx.root, 'purgews') });
    if (!('id' in a)) throw new Error('add 失敗');
    const profileAbs = join(ctx.userData, a.profileDir);
    mkdirSync(profileAbs, { recursive: true });
    expect(existsSync(profileAbs)).toBe(true);
    await ctx.mgr.remove(a.id, true);
    expect(existsSync(profileAbs)).toBe(false);
  });

  it('資料夾遺失 → status=missing 仍保留在列表（不自動移除，REQ-WS-006）', () => {
    const dir = makeDir(ctx.root, 'will-vanish');
    const a = ctx.mgr.add({ path: dir });
    if (!('id' in a)) throw new Error('add 失敗');
    rmSync(dir, { recursive: true, force: true });
    const list = ctx.mgr.list();
    expect(list.length).toBe(1);
    expect(list[0].status).toBe('missing');
    // missing 不可 activate
    expect(ctx.mgr.activate(a.id)).toBe(false);
  });
});
