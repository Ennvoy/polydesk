// P-4 GitService worktree 操作單測（REQ-WT-002/010/012/015）：
// - parseWorktreeList：--porcelain -z 解析（main/branch/detached/prunable）
// - argv 硬化不變量：worktree 指令帶 read/write 硬化、路徑經 '--'、非法 ref 永不執行 git
// 以注入 exec 捕捉 argv（不跑真 git；真 git 鏈路由 F-11/F-12 e2e 蓋）。
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService, parseWorktreeList } from './GitService';

const NUL = '\0';

describe('parseWorktreeList（--porcelain -z）', () => {
  it('解析 main/branch/detached/prunable 四型', () => {
    const raw =
      `worktree C:/repos/app${NUL}HEAD aaaa${NUL}branch refs/heads/main${NUL}${NUL}` +
      `worktree C:/repos/app-worktrees/feat-x${NUL}HEAD bbbb${NUL}branch refs/heads/feat/x${NUL}${NUL}` +
      `worktree C:/repos/app-worktrees/detached1${NUL}HEAD cccc${NUL}detached${NUL}${NUL}` +
      `worktree C:/repos/app-worktrees/gone${NUL}HEAD dddd${NUL}branch refs/heads/old${NUL}prunable gitdir file points to non-existent location${NUL}${NUL}`;
    const list = parseWorktreeList(raw);
    expect(list).toHaveLength(4);
    expect(list[0]).toMatchObject({ path: 'C:/repos/app', branch: 'main', head: 'aaaa', isMain: true, prunable: false });
    expect(list[1]).toMatchObject({ path: 'C:/repos/app-worktrees/feat-x', branch: 'feat/x', isMain: false });
    expect(list[2]).toMatchObject({ branch: null, isMain: false });
    expect(list[3]).toMatchObject({ prunable: true });
  });

  it('空輸出 → 空陣列', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

type Call = { args: string[]; env: NodeJS.ProcessEnv };

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'polydesk-wt-'));
  const userData = join(root, 'ud');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  const dir = join(root, 'ws');
  mkdirSync(dir, { recursive: true });
  const res = mgr.add({ path: dir });
  if (!('id' in res)) throw new Error('add 失敗');
  const calls: Call[] = [];
  const exec = ((_file: string, args: string[], options: { env?: NodeJS.ProcessEnv }, cb: (e: null, so: Buffer, se: Buffer) => void) => {
    calls.push({ args, env: options.env ?? {} });
    cb(null, Buffer.from(''), Buffer.from(''));
    return { stdin: { end: () => {} } };
  }) as unknown as ConstructorParameters<typeof GitService>[1];
  const svc = new GitService(mgr, exec);
  return { root, dir, wsId: res.id, calls, svc };
}

describe('GitService worktree argv 硬化（REQ-WT-015 對齊 REQ-SCM-009）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('worktreeList：帶 read 硬化旗標 + porcelain -z + readEnv（NOSYSTEM）', async () => {
    await ctx.svc.worktreeList(ctx.wsId);
    const c = ctx.calls[0];
    expect(c.args).toContain('worktree');
    expect(c.args).toContain('--porcelain');
    expect(c.args).toContain('-z');
    expect(c.args.join(' ')).toContain('core.fsmonitor=false');
    expect(c.env.GIT_CONFIG_NOSYSTEM).toBe('1');
  });

  it('worktreeAdd（existing）：路徑在 -- 之後、分支經驗證、write 硬化 env', async () => {
    const target = join(ctx.root, 'ws-worktrees', 'feat-x');
    await ctx.svc.worktreeAdd(ctx.wsId, { kind: 'existing', name: 'feat/x' }, target);
    const c = ctx.calls[0];
    const sep = c.args.indexOf('--');
    expect(sep).toBeGreaterThan(-1);
    expect(c.args[sep + 1]).toBe(target);
    expect(c.args[c.args.length - 1]).toBe('feat/x');
    expect(c.env.GIT_CONFIG_KEY_0).toBe('core.fsmonitor');
  });

  it('worktreeAdd（new + base）：-b <name> 且 base 置尾', async () => {
    const target = join(ctx.root, 'ws-worktrees', 'feat-y');
    await ctx.svc.worktreeAdd(ctx.wsId, { kind: 'new', name: 'feat/y', base: 'main' }, target);
    const c = ctx.calls[0];
    expect(c.args).toContain('-b');
    expect(c.args[c.args.indexOf('-b') + 1]).toBe('feat/y');
    expect(c.args[c.args.length - 1]).toBe('main');
  });

  it('非法分支名 → 直接 throw、永不執行 git', async () => {
    const target = join(ctx.root, 'ws-worktrees', 'x');
    await expect(ctx.svc.worktreeAdd(ctx.wsId, { kind: 'existing', name: 'bad name' }, target)).rejects.toThrow();
    await expect(ctx.svc.worktreeAdd(ctx.wsId, { kind: 'new', name: 'ok', base: '$(rm -rf)' }, target)).rejects.toThrow();
    expect(ctx.calls).toHaveLength(0);
  });

  it('worktreeRemove：--force 只在 force=true 出現、路徑在 -- 後', async () => {
    const target = join(ctx.root, 'ws-worktrees', 'feat-x');
    await ctx.svc.worktreeRemove(ctx.wsId, target, false);
    expect(ctx.calls[0].args).not.toContain('--force');
    await ctx.svc.worktreeRemove(ctx.wsId, target, true);
    const c = ctx.calls[1];
    expect(c.args).toContain('--force');
    expect(c.args[c.args.indexOf('--') + 1]).toBe(target);
  });

  it('worktreePrune：帶 read 硬化', async () => {
    await ctx.svc.worktreePrune(ctx.wsId);
    expect(ctx.calls[0].args).toContain('prune');
    expect(ctx.calls[0].args.join(' ')).toContain('core.hooksPath=');
  });
});
