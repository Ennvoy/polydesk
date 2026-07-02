// P-4 WorkspaceManager worktree 納管單測（REQ-WT-003）：worktree 標記持久化、
// 信任繼承主工作樹、主工作樹未納管的處置、去重。真實 fs temp + 真實 StateStore。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from './WorkspaceManager';
import { WorkspaceLifecycle } from './workspaceLifecycle';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'polydesk-wtmgr-'));
  const userData = join(root, 'ud');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  const mainDir = join(root, 'repo');
  mkdirSync(mainDir, { recursive: true });
  const wtDir = join(root, 'repo-worktrees', 'feat-x');
  mkdirSync(wtDir, { recursive: true });
  return { root, userData, store, mgr, mainDir, wtDir };
}

describe('WorkspaceManager.addWorktree（REQ-WT-003）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('主工作樹已納管 → 繼承其 trusted、記 worktree.mainPath（正規化）', () => {
    const main = ctx.mgr.add({ path: ctx.mainDir });
    if (!('id' in main)) throw new Error('main add 失敗');
    const r = ctx.mgr.addWorktree({ path: ctx.wtDir, mainPath: ctx.mainDir });
    if (!('id' in r)) throw new Error(`addWorktree 失敗: ${JSON.stringify(r)}`);
    expect(r.trusted).toBe(main.trusted);
    expect(r.worktree?.mainPath).toBe(resolve(ctx.mainDir));
    // list() 帶回標記
    const listed = ctx.mgr.list().find((w) => w.id === r.id);
    expect(listed?.worktree?.mainPath).toBe(resolve(ctx.mainDir));
  });

  it('主工作樹未納管且無 trusted 覆寫 → error main-not-managed；帶 trusted:true 覆寫 → ok', () => {
    const r1 = ctx.mgr.addWorktree({ path: ctx.wtDir, mainPath: ctx.mainDir });
    expect(r1).toEqual({ error: 'main-not-managed' });
    const r2 = ctx.mgr.addWorktree({ path: ctx.wtDir, mainPath: ctx.mainDir, trusted: true });
    expect('id' in r2).toBe(true);
  });

  it('同路徑去重 → duplicate；不存在路徑 → invalid', () => {
    ctx.mgr.add({ path: ctx.mainDir });
    const first = ctx.mgr.addWorktree({ path: ctx.wtDir, mainPath: ctx.mainDir });
    expect('id' in first).toBe(true);
    expect(ctx.mgr.addWorktree({ path: ctx.wtDir, mainPath: ctx.mainDir })).toEqual({ error: 'duplicate' });
    expect(ctx.mgr.addWorktree({ path: join(ctx.root, 'nope'), mainPath: ctx.mainDir })).toEqual({ error: 'invalid' });
  });

  it('worktree 標記持久化：新 manager 讀同一 store 仍看得到（REQ-PERSIST 接縫）', () => {
    ctx.mgr.add({ path: ctx.mainDir });
    const r = ctx.mgr.addWorktree({ path: ctx.wtDir, mainPath: ctx.mainDir });
    if (!('id' in r)) throw new Error('addWorktree 失敗');
    const store2 = new StateStore(join(ctx.userData, 'state.json'));
    store2.load();
    const mgr2 = new WorkspaceManager(store2, new WorkspaceLifecycle(), ctx.userData);
    const again = mgr2.list().find((w) => w.id === r.id);
    expect(again?.worktree?.mainPath).toBe(resolve(ctx.mainDir));
  });

  it('預設名稱＝即時分支未知時用資料夾名（顯示層再覆蓋）；一般 add 不帶 worktree 標記', () => {
    const main = ctx.mgr.add({ path: ctx.mainDir });
    if (!('id' in main)) throw new Error('main add 失敗');
    expect(main.worktree).toBeUndefined();
    const r = ctx.mgr.addWorktree({ path: ctx.wtDir, mainPath: ctx.mainDir });
    if (!('id' in r)) throw new Error('addWorktree 失敗');
    expect(r.name).toBe('feat-x');
  });
});
