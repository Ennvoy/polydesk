import { describe, it, expect, vi } from 'vitest';
import { ChildProcess } from 'node:child_process';
import { GitService, type GitExecFn } from './GitService';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';

function delayedGit(responseAfterMs: number): GitExecFn {
  return (_file, args, options, callback) => {
    const timeout = setTimeout(() => {
      clearTimeout(response);
      callback(Object.assign(new Error('process killed'), { killed: true, signal: 'SIGTERM' as const }), Buffer.alloc(0), Buffer.alloc(0));
    }, options.timeout);
    const response = setTimeout(() => {
      clearTimeout(timeout);
      const output = args.includes('status')
        ? `# branch.oid ${'a'.repeat(40)}\0# branch.head main\0# branch.ab +0 -0\0`
        : '';
      callback(null, Buffer.from(output), Buffer.alloc(0));
    }, responseAfterMs);
    return new ChildProcess();
  };
}

const workspaces = { get: () => ({ path: 'C:/status-timeout-test' }) } as unknown as WorkspaceManager;

describe('大型工作樹 status 專用讀取逾時', () => {
  it('status 與 changes 可在超過 10 秒後正常完成', async () => {
    vi.useFakeTimers();
    try {
      const svc = new GitService(workspaces, delayedGit(11_000));
      const status = svc.status('ws');
      const changes = svc.changes('ws');
      let finished = false;
      void status.then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await status).toMatchObject({ isRepo: true, branch: 'main' });
      expect(await changes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('超過 30 秒的狀態讀取顯示具名逾時並保留失敗', async () => {
    vi.useFakeTimers();
    try {
      const svc = new GitService(workspaces, delayedGit(31_000));
      const failure = expect(svc.status('ws')).rejects.toThrow('Git 狀態讀取逾時（30 秒）');
      await vi.advanceTimersByTimeAsync(30_000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });

  it('一般本機寫入仍在 10 秒到期，不沿用 status 的 30 秒預算', async () => {
    vi.useFakeTimers();
    try {
      const svc = new GitService(workspaces, delayedGit(11_000));
      const failure = expect(svc.stage('ws', ['tracked.txt'], true)).rejects.toThrow('Git 本機操作逾時（10 秒）');
      await vi.advanceTimersByTimeAsync(10_000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });
});
