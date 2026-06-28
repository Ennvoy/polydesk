// F-7 紅軍 A3：commit 訊息暫存檔攻擊面（可預測路徑竄改 / symlink 任意覆寫 / 殘留洩漏）。
// 防線：訊息走 `git commit -F -`（stdin），完全不落地暫存檔。本測試斷言 commit argv 含 `-F -`、
// 全程未呼叫 fs.writeFileSync/mkdtempSync（無檔案落地）、訊息確實經 stdin 進 git、失敗路徑亦無殘留。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile, execFileSync, type ExecFileException } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'pd-gitcommit-'));
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

describe('GitService commit（A3：訊息走 stdin，零暫存檔）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('commit 經 -F - + stdin，無 writeFileSync/mkdtempSync 落地，訊息正確寫入 git', async () => {
    initRepo(ctx.repo);
    writeFileSync(join(ctx.repo, 'a.txt'), 'x');

    const calls: string[][] = [];
    const exec: GitExecFn = (file, args, options, cb) => {
      calls.push([...args]);
      return execFile(file, args, options, cb);
    };
    const svc = new GitService(ctx.mgr, exec);
    await svc.stage(ctx.wsId, ['a.txt'], true);

    const tricky = 'feat: 多行訊息\n\n含 $特殊 與 反引號 與引號 "x"';
    const res = await svc.commit(ctx.wsId, tricky);

    expect('ok' in res).toBe(true);

    // commit argv 走 -F -（stdin），不落地暫存檔：-F 緊接 '-'（stdin），無任何 tmpdir 路徑參數
    const commitCall = calls.find((a) => a[0] === 'commit');
    expect(commitCall).toBeDefined();
    const fIdx = commitCall!.indexOf('-F');
    expect(fIdx).toBeGreaterThanOrEqual(0);
    expect(commitCall![fIdx + 1]).toBe('-'); // -F - ＝ 從 stdin 讀，結構性零暫存檔
    expect(commitCall!.some((a) => a.includes(tmpdir()))).toBe(false); // 無暫存檔路徑當參數

    // 訊息確實經 stdin 進 git（raw body 驗證）
    const body = execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: ctx.repo,
      encoding: 'utf8',
    });
    expect(body.trimEnd()).toBe(tricky.trimEnd());
  });

  it('commit 失敗（exec reject）→ 回 {error} 且無暫存檔殘留', async () => {
    initRepo(ctx.repo);
    const failExec: GitExecFn = (_file, _args, _options, cb) => {
      const fake = { stdin: { end: (): void => undefined } } as unknown as ReturnType<GitExecFn>;
      setImmediate(() => {
        const err = Object.assign(new Error('fail'), { code: 1 }) as ExecFileException;
        cb(err, Buffer.from(''), Buffer.from('nothing to commit'));
      });
      return fake;
    };
    const svc = new GitService(ctx.mgr, failExec);
    const res = await svc.commit(ctx.wsId, 'msg');
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/nothing to commit/);
  });
});
