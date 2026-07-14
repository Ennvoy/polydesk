// 智慧 commit message 服務單測：取 staged diff（真 git repo）+ 無暫存時回明確 error（不呼叫引擎、不耗額度）。
// 引擎端到端（真 claude/codex/agy 產生）走 dogfood，因為會耗 LLM 額度且需登入，不在 CI 單測內跑。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService } from '../git/GitService';
import { CommitMessageService } from './CommitMessageService';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pd-aimsg-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  };
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 't@example.com']);
  run(['config', 'user.name', 'Polydesk Test']);
  run(['config', 'commit.gpgsign', 'false']);
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  const mgr = new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
  const added = mgr.add({ path: repo });
  if (!('id' in added)) throw new Error('workspace add failed');
  return { root, repo, store, mgr, wsId: added.id, run };
}

describe('CommitMessageService（智慧 commit message）', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });

  it('無已暫存變更 → 回明確 error（不呼叫引擎）', async () => {
    const svc = new CommitMessageService(ctx.mgr, new GitService(ctx.mgr), ctx.store);
    const r = await svc.generate(ctx.wsId);
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('暫存');
  });

  it('stagedDiff 取到已暫存的變更內容（含檔名與新增行）', async () => {
    writeFileSync(join(ctx.repo, 'hello.txt'), 'first line\nsecond line\n');
    ctx.run(['add', 'hello.txt']);
    const { patch, truncated } = await new GitService(ctx.mgr).stagedDiff(ctx.wsId, 12_000);
    expect(patch).toContain('hello.txt');
    expect(patch).toContain('first line');
    expect(truncated).toBe(false);
  });

  it('stagedDiff 超量會截斷並標記 truncated', async () => {
    writeFileSync(join(ctx.repo, 'big.txt'), 'x\n'.repeat(20_000));
    ctx.run(['add', 'big.txt']);
    const { patch, truncated } = await new GitService(ctx.mgr).stagedDiff(ctx.wsId, 2_000);
    expect(truncated).toBe(true);
    expect(patch).toContain('已截斷');
  });
});
