// F-7 紅軍 A2：把資料夾當工作區即被 RCE 的攻擊面。
// 半可信 repo 的 .git/config 放惡意 fsmonitor（背景 status 輪詢自動執行）+ .gitattributes/textconv（點 diff 執行）。
// 防線：每個 read/diff 都帶 -c core.fsmonitor=false / -c core.hooksPath= / --no-pager，diff 另帶 --no-textconv，
// env 帶 GIT_CONFIG_NOSYSTEM=1 / GIT_OPTIONAL_LOCKS=0。本測試斷言 pwn 檔不被建立 + argv/env 逐次帶硬化。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService, type GitExecFn } from './GitService';

function initRepo(dir: string): void {
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Polydesk Test']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['config', 'core.autocrlf', 'false']);
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pd-gitsec-'));
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

describe('GitService 安全硬化（A2：惡意 .git/config 不得 RCE）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('status 輪詢 ×3 + diff 不觸發 fsmonitor/textconv；每次 read argv/env 帶硬化', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'f.txt'), 'v1\n');

    // 乾淨 svc 先 commit（讓 diff 有對象）
    const clean = new GitService(ctx.mgr);
    await clean.stage(ctx.wsId, ['f.txt'], true);
    await clean.commit(ctx.wsId, 'init');
    writeFileSync(join(ctx.repo, 'f.txt'), 'v2\n'); // 製造 diff

    // pwn 腳本（forward-slash 路徑避免 git config 反斜線轉義）
    const pwnFile = join(ctx.repo, 'PWNED');
    const pwn2File = join(ctx.repo, 'PWNED2');
    const pwnFs = join(ctx.root, 'pwn-fs.cjs');
    const pwnTc = join(ctx.root, 'pwn-tc.cjs');
    writeFileSync(pwnFs, `require('fs').writeFileSync(${JSON.stringify(pwnFile)}, 'x');`);
    writeFileSync(
      pwnTc,
      `require('fs').writeFileSync(${JSON.stringify(pwn2File)}, 'x'); process.stdout.write('');`,
    );
    const fsCmd = `node "${pwnFs.replace(/\\/g, '/')}"`;
    const tcCmd = `node "${pwnTc.replace(/\\/g, '/')}"`;

    // 惡意 config / attributes（commit 後注入）
    appendFileSync(
      join(ctx.repo, '.git', 'config'),
      `\n[core]\n\tfsmonitor = ${fsCmd}\n[diff "evil"]\n\ttextconv = ${tcCmd}\n`,
    );
    writeFileSync(join(ctx.repo, '.gitattributes'), '* diff=evil\n');

    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const exec: GitExecFn = (file, args, options, cb) => {
      calls.push({ args: [...args], env: (options.env ?? {}) as NodeJS.ProcessEnv });
      return execFile(file, args, options, cb);
    };
    const svc = new GitService(ctx.mgr, exec);

    await svc.status(ctx.wsId);
    await svc.status(ctx.wsId);
    await svc.status(ctx.wsId);
    await svc.diff(ctx.wsId, 'f.txt', false);

    // 零點擊 RCE 防線：pwn 檔不得被建立
    expect(existsSync(pwnFile)).toBe(false);
    expect(existsSync(pwn2File)).toBe(false);

    const reads = calls.filter((c) => c.args.includes('status') || c.args.includes('diff'));
    expect(reads.length).toBe(4);
    for (const c of reads) {
      expect(c.args).toContain('core.fsmonitor=false');
      expect(c.args).toContain('core.hooksPath=');
      expect(c.args).toContain('--no-pager');
      expect(c.env.GIT_CONFIG_NOSYSTEM).toBe('1');
      expect(c.env.GIT_OPTIONAL_LOCKS).toBe('0');
    }
    const diffCall = calls.find((c) => c.args.includes('diff'));
    expect(diffCall?.args).toContain('--no-textconv');
  });
});
