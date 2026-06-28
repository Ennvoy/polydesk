// X-4 REQ-SEC-002 / REQ-SCM-009：git spawn 的 env 不漏繼承機密/危險 GIT_*；write 路徑亦關 fsmonitor（防一鍵 RCE）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../../src/main/store/StateStore';
import { WorkspaceManager } from '../../src/main/workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../../src/main/workspace/workspaceLifecycle';
import { GitService, type GitExecFn } from '../../src/main/git/GitService';

function initRepo(dir: string): void {
  const run = (args: string[]): void => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }) as unknown as void;
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Polydesk Test']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['config', 'core.autocrlf', 'false']);
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pd-gitenv-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  const added = mgr.add({ path: repo });
  if (!('id' in added)) throw new Error('workspace add failed');
  return { root, repo, mgr, wsId: added.id };
}

describe('GitService env 硬化（X-4）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('繼承的危險 GIT_*/機密不傳給 git；read 帶 NOSYSTEM、write 帶 fsmonitor=false env-config', async () => {
    initRepo(ctx.repo);
    // 模擬啟動環境被污染：這些都不該流進 git 子程序
    const poison = ['GIT_EXTERNAL_DIFF', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SOME_API_TOKEN'];
    const saved: Record<string, string | undefined> = {};
    for (const k of poison) {
      saved[k] = process.env[k];
      process.env[k] = 'evil';
    }
    try {
      const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
      const exec: GitExecFn = (file, args, options, cb) => {
        calls.push({ args: [...args], env: (options.env ?? {}) as NodeJS.ProcessEnv });
        return execFile(file, args, options, cb);
      };
      const svc = new GitService(ctx.mgr, exec);
      await svc.status(ctx.wsId); // read
      writeFileSync(join(ctx.repo, 'a.txt'), 'x');
      await svc.stage(ctx.wsId, ['a.txt'], true); // write
      await svc.commit(ctx.wsId, 'init'); // write

      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        for (const k of poison) expect(c.env[k], `${k} 不該流進 git`).toBeUndefined();
      }
      const read = calls.find((c) => c.args.includes('status'));
      expect(read?.env.GIT_CONFIG_NOSYSTEM).toBe('1');
      const write = calls.find((c) => c.args.includes('commit') || c.args.includes('add'));
      // write 路徑以 env-config 關 fsmonitor（覆蓋惡意 repo-local）
      expect(write?.env.GIT_CONFIG_KEY_0).toBe('core.fsmonitor');
      expect(write?.env.GIT_CONFIG_VALUE_0).toBe('false');
    } finally {
      for (const k of poison) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it('惡意 repo-local core.fsmonitor 在 write（stage）不得 RCE', async () => {
    initRepo(ctx.repo);
    const clean = new GitService(ctx.mgr);
    writeFileSync(join(ctx.repo, 'f.txt'), 'v1\n');
    await clean.stage(ctx.wsId, ['f.txt'], true);
    await clean.commit(ctx.wsId, 'init');

    // 注入惡意 fsmonitor（index refresh 時會被 git 執行）
    const pwnFile = join(ctx.repo, 'PWNED_WRITE');
    const pwnScript = join(ctx.root, 'pwn-write.cjs');
    writeFileSync(pwnScript, `require('fs').writeFileSync(${JSON.stringify(pwnFile)}, 'x');`);
    appendFileSync(
      join(ctx.repo, '.git', 'config'),
      `\n[core]\n\tfsmonitor = node "${pwnScript.replace(/\\/g, '/')}"\n`,
    );

    // 對該 repo 做 write 操作（stage 觸發 index refresh → 若 fsmonitor 未被關即 RCE）
    writeFileSync(join(ctx.repo, 'f.txt'), 'v2\n');
    const svc = new GitService(ctx.mgr);
    await svc.stage(ctx.wsId, ['f.txt'], true);
    await svc.commit(ctx.wsId, 'second');

    expect(existsSync(pwnFile), 'write 路徑的 fsmonitor 必須被 env-config 關閉').toBe(false);
  });
});
