// PE-4 GitService.fetch 單元測試（真 git + 真 bare remote，無 mock）。
// fetch 只更新 remote-tracking ref：遠端進了新 commit 後，本地 status.behind 0→1、工作樹不動、不合併。
// 種子放測試本體而非 beforeEach——真 git 多次 spawn 在機器高負載時會超過 hook 預設 25s 上限（假紅）。

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../store/StateStore';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import { GitService } from './GitService';

function git(cwd: string, ...args: string[]): string {
  // 單指令 30s 上限：機器高負載時哪個 spawn 卡住直接現形，不讓整個測試吃滿 timeout 才死。
  return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 30_000 }).toString().trim();
}

function configUser(dir: string): void {
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Polydesk Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
}

function makeManager(root: string): WorkspaceManager {
  const userData = join(root, 'userData');
  mkdirSync(userData, { recursive: true });
  const store = new StateStore(join(userData, 'state.json'));
  store.load();
  return new WorkspaceManager(store, new WorkspaceLifecycle(), userData);
}

function cleanup(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows 高負載下 git 子程序 handle 釋放慢會 EPERM——temp 目錄殘留交給 OS，不讓清理噪音假紅。
  }
}

describe('GitService.fetch（真 git＋真 bare remote）', () => {
  it('遠端有新 commit：fetch 前 behind=0（過期快照）→ fetch 後 behind=1、工作樹不被合併', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fetch-'));
    try {
      // remote：真 bare repo（扮演 GitHub）；work：本地工作 repo，推 init commit 建立 upstream
      const remote = join(root, 'remote.git');
      mkdirSync(remote, { recursive: true });
      git(remote, 'init', '--bare', '-b', 'main');
      const work = join(root, 'work');
      mkdirSync(work, { recursive: true });
      git(work, 'init', '-b', 'main');
      configUser(work);
      writeFileSync(join(work, 'a.txt'), 'v1\n');
      git(work, 'add', '.');
      git(work, 'commit', '-m', 'init');
      const commitA = git(work, 'rev-parse', 'HEAD');
      git(work, 'remote', 'add', 'origin', remote);
      git(work, 'push', '-u', 'origin', 'main');
      // 造出「遠端比本地新、本地渾然不知」的真實狀態（省掉第二個 clone 的 ~8 次 spawn，高負載不假紅）：
      // 推 commit B 上遠端後，把本地與 remote-tracking ref 都退回 A——等同 B 是別台機器推的。
      writeFileSync(join(work, 'b.txt'), 'from other\n');
      git(work, 'add', '.');
      git(work, 'commit', '-m', 'remote-side commit');
      git(work, 'push', 'origin', 'main');
      git(work, 'reset', '--hard', commitA);
      git(work, 'update-ref', 'refs/remotes/origin/main', commitA);

      const mgr = makeManager(root);
      const added = mgr.add({ path: work });
      if (!('id' in added)) throw new Error('workspace add failed');
      const svc = new GitService(mgr);

      const before = await svc.status(added.id);
      expect(before.behind).toBe(0); // remote-tracking ref 過期 → 本地看不到落後

      const r = await svc.fetch(added.id);
      expect(r).toEqual({ ok: true });

      const after = await svc.status(added.id);
      expect(after.behind).toBe(1); // ↓N 未拉取的資料來源
      expect(after.ahead).toBe(0);
      // fetch 不合併：遠端新增的 b.txt 不出現在工作樹、既有檔案內容不變
      expect(existsSync(join(work, 'b.txt'))).toBe(false);
      expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe('v1\n');
    } finally {
      cleanup(root);
    }
  }, 120_000);

  it('workspace 不存在 → { error }（免 git 種子）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fetch-'));
    try {
      const svc = new GitService(makeManager(root));
      const r = await svc.fetch('nope');
      expect(r).toEqual({ error: 'workspace not found' });
    } finally {
      cleanup(root);
    }
  }, 30_000);
});
