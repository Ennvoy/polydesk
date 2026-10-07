import { describe, expect, it, vi } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService, type GitExecFn } from './GitService';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';

async function withRepo(check: (svc: GitService, git: (...args: string[]) => string, importCommits: (count: number, branch?: string, from?: string) => void) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pd-log-page-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const svc = new GitService({ get: () => ({ path: dir }) } as unknown as WorkspaceManager);
  let serial = 0;
  const importCommits = (count: number, branch = 'main', from?: string): void => {
    const start = from ?? (serial > 0 ? git('rev-parse', branch).trim() : undefined);
    const chunks = start ? [`reset refs/heads/${branch}\nfrom ${start}\n\n`] : [];
    for (let index = 0; index < count; index++) {
      serial += 1;
      const subject = `history-${String(serial).padStart(4, '0')}`;
      // 交錯日期讓測試可抓出把 --topo-order 換成日期序的錯誤。
      const when = 1_700_000_000 + (serial % 7) * 100;
      chunks.push(`commit refs/heads/${branch}\nauthor E2E <e2e@test> ${when} +0000\ncommitter E2E <e2e@test> ${when} +0000\ndata ${subject.length}\n${subject}\nM 100644 inline history.txt\ndata ${subject.length}\n${subject}\n\n`);
    }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: chunks.join(''), stdio: 'pipe' });
  };
  try {
    git('init', '-b', 'main');
    importCommits(35);
    await check(svc, git, importCommits);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('GitService 真歷史分頁', () => {
  it('多 root 與時間偏移時 20→30→40 的順序等於完整 --all --topo-order，末頁停止', async () => withRepo(async (svc, git, importCommits) => {
    const fork = git('rev-list', '--reverse', 'main').trim().split('\n')[10];
    importCommits(8, 'side', fork);
    const expected = git('log', '--all', '--topo-order', '--format=%H').trim().split('\n');
    expect(expected).toHaveLength(43);
    const first = await svc.logPage({ wsId: 'ws', offset: 0, limit: 20 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entries).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const second = await svc.logPage({ wsId: 'ws', offset: 20, limit: 10, rootsVersion: first.rootsVersion, previousHash: first.entries.at(-1)?.hash });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entries).toHaveLength(10);
    expect(second.hasMore).toBe(true);
    const third = await svc.logPage({ wsId: 'ws', offset: 30, limit: 10, rootsVersion: second.rootsVersion, previousHash: second.entries.at(-1)?.hash });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.entries).toHaveLength(10);
    expect(third.hasMore).toBe(true);
    const last = await svc.logPage({ wsId: 'ws', offset: 40, limit: 10, rootsVersion: third.rootsVersion, previousHash: third.entries.at(-1)?.hash });
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect(last.entries).toHaveLength(3);
    expect(last.hasMore).toBe(false);
    expect([...first.entries, ...second.entries, ...third.entries, ...last.entries].map((entry) => entry.hash)).toEqual(expected);
  }), 120_000);

  it.each([20, 21, 30, 31])('%i 筆的 lookahead 與短末頁沒有 off-by-one', async (count) => withRepo(async (svc, git) => {
    const head = git('rev-list', '--reverse', 'main').trim().split('\n')[count - 1];
    git('update-ref', 'refs/heads/main', head);
    const first = await svc.logPage({ wsId: 'ws', offset: 0, limit: 20 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entries).toHaveLength(20);
    expect(first.hasMore).toBe(count > 20);
    if (count === 20) return;
    const second = await svc.logPage({ wsId: 'ws', offset: 20, limit: 10, rootsVersion: first.rootsVersion, previousHash: first.entries.at(-1)?.hash });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entries).toHaveLength(Math.min(10, count - 20));
    expect(second.hasMore).toBe(count > 30);
    if (count <= 30) return;
    const third = await svc.logPage({ wsId: 'ws', offset: 30, limit: 10, rootsVersion: second.rootsVersion, previousHash: second.entries.at(-1)?.hash });
    expect(third.ok).toBe(true);
    if (third.ok) { expect(third.entries).toHaveLength(1); expect(third.hasMore).toBe(false); }
  }), 120_000);

  it('refs 改動與錯誤邊界明確拒絕接頁', async () => withRepo(async (svc, git, importCommits) => {
    const first = await svc.logPage({ wsId: 'ws', offset: 0, limit: 20 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await svc.logPage({ wsId: 'ws', offset: 20, limit: 10, rootsVersion: first.rootsVersion, previousHash: '0'.repeat(40) }))
      .toEqual({ ok: false, code: 'history-changed' });
    importCommits(1, 'new-root', git('rev-list', '--max-parents=0', 'main').trim());
    expect(await svc.logPage({ wsId: 'ws', offset: 20, limit: 10, rootsVersion: first.rootsVersion, previousHash: first.entries.at(-1)?.hash }))
      .toEqual({ ok: false, code: 'history-changed' });
  }), 120_000);

  it('同一提交的裝飾 ref 改名會使舊頁版本失效', async () => withRepo(async (svc, git) => {
    git('tag', 'shared-name', 'main');
    git('tag', 'other-name', 'main');
    const first = await svc.logPage({ wsId: 'ws', offset: 0, limit: 20 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entries[0].refs.length).toBeGreaterThanOrEqual(3);
    git('tag', '-d', 'shared-name');
    git('tag', 'renamed-name', 'main');
    expect(await svc.logPage({ wsId: 'ws', offset: 20, limit: 10, rootsVersion: first.rootsVersion, previousHash: first.entries.at(-1)?.hash }))
      .toEqual({ ok: false, code: 'history-changed' });
  }), 120_000);

  it('頁面讀取期間 ref 改動時也拒絕交付混合版本', async () => withRepo(async (_svc, git) => {
    let rootProbes = 0;
    const wrapped: GitExecFn = (file, args, options, callback) => execFile(file, args, options, (error, stdout, stderr) => {
      if (args.includes('--no-walk=unsorted') && ++rootProbes === 1) git('tag', 'during-read', 'main');
      callback(error, stdout, stderr);
    });
    // 測試 repo 路徑由真 Git 取得，仍透過受驗證的 workspace path 執行。
    const dir = git('rev-parse', '--show-toplevel').trim();
    const inRepo = new GitService({ get: () => ({ path: dir }) } as unknown as WorkspaceManager, wrapped);
    expect(await inRepo.logPage({ wsId: 'ws', offset: 0, limit: 20 })).toEqual({ ok: false, code: 'history-changed' });
    expect(rootProbes).toBe(2);
  }), 120_000);

  it('歷史超過 1000 筆仍可讀取第 1001 筆，沒有總量截斷', async () => withRepo(async (svc, git, importCommits) => {
    importCommits(970);
    const hashes = git('log', '--all', '--topo-order', '--format=%H').trim().split('\n');
    expect(hashes).toHaveLength(1005);
    const first = await svc.logPage({ wsId: 'ws', offset: 0, limit: 20 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const beyond = await svc.logPage({ wsId: 'ws', offset: 1000, limit: 10, rootsVersion: first.rootsVersion, previousHash: hashes[999] });
    expect(beyond.ok).toBe(true);
    if (beyond.ok) {
      expect(beyond.entries.map((entry) => entry.hash)).toEqual(hashes.slice(1000));
      expect(beyond.hasMore).toBe(false);
    }
  }), 120_000);

  it('拒絕無效 offset/limit 且不啟動 Git', async () => {
    const run = vi.fn();
    const svc = new GitService({ get: () => ({ path: 'unused' }) } as unknown as WorkspaceManager, run);
    for (const offset of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.2, Number.MAX_SAFE_INTEGER]) {
      await expect(svc.logPage({ wsId: 'ws', offset, limit: 10 })).rejects.toThrow('invalid history page request');
    }
    await expect(svc.logPage({ wsId: 'ws', offset: 0, limit: 101 })).rejects.toThrow('invalid history page request');
    await expect(svc.logPage({ wsId: 'ws', offset: 20, limit: 10 })).rejects.toThrow('invalid history page request');
    expect(run).not.toHaveBeenCalled();
  });
});
