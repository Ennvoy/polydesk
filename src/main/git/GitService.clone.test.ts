import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile, type ChildProcess, type ExecFileException } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { GitService, type GitExecFn } from './GitService';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pd-clone-'));
  const parent = join(root, 'projects');
  const userData = join(root, 'userData');
  mkdirSync(parent, { recursive: true });
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  return { root, parent, mgr };
}

describe('GitService.clone', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('以安全 argv Clone，完成後加入並回傳工作區', async () => {
    const calls: { args: string[]; cwd?: string; env: NodeJS.ProcessEnv }[] = [];
    const fakeExec: GitExecFn = (_file, args, options, callback) => {
      calls.push({ args: [...args], cwd: typeof options.cwd === 'string' ? options.cwd : options.cwd?.toString(), env: options.env ?? {} });
      mkdirSync(args[3], { recursive: true });
      queueMicrotask(() => callback(null, Buffer.alloc(0), Buffer.alloc(0)));
      return {} as ChildProcess;
    };
    const svc = new GitService(ctx.mgr, fakeExec);
    const result = await svc.clone({
      url: 'https://github.com/openai/codex.git',
      parentPath: ctx.parent,
      directoryName: 'codex',
    });

    expect('wsId' in result).toBe(true);
    expect(calls[0].args).toEqual(['clone', '--', 'https://github.com/openai/codex.git', join(ctx.parent, 'codex')]);
    expect(calls[0].cwd).toBe(ctx.parent);
    expect(calls[0].env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(ctx.mgr.list().map((w) => w.path)).toEqual([join(ctx.parent, 'codex')]);
  });

  it('輸入無效或目標已存在時不執行 Git', async () => {
    let called = false;
    const fakeExec: GitExecFn = (...args) => {
      called = true;
      return execFile(...args);
    };
    const svc = new GitService(ctx.mgr, fakeExec);
    const invalid = await svc.clone({ url: 'ext::evil', parentPath: ctx.parent, directoryName: 'repo' });
    expect(invalid).toMatchObject({ code: 'invalid-url' });
    mkdirSync(join(ctx.parent, 'repo'));
    const exists = await svc.clone({ url: 'https://example.com/a/repo.git', parentPath: ctx.parent, directoryName: 'repo' });
    expect(exists).toMatchObject({ code: 'target-exists' });
    expect(called).toBe(false);
  });

  it('把 Git 認證錯誤分類為 auth', async () => {
    const fakeExec: GitExecFn = (_file, _args, _options, callback) => {
      const error = Object.assign(new Error('exit 128'), { code: 128 }) as ExecFileException;
      queueMicrotask(() => callback(error, Buffer.alloc(0), Buffer.from('fatal: Authentication failed')));
      return {} as ChildProcess;
    };
    const svc = new GitService(ctx.mgr, fakeExec);
    const result = await svc.clone({
      url: 'https://example.com/a/repo.git',
      parentPath: ctx.parent,
      directoryName: 'repo',
    });
    expect(result).toMatchObject({ code: 'auth' });
    expect(ctx.mgr.list()).toHaveLength(0);
  });
});
