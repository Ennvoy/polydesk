// 紅軍 A2（high）：worktree 信任繼承繞過。worktree 登記路徑是 repo 可寫 metadata；
// 不可只信 git 自報「這是我的 worktree」就賦 trusted。verifyWorktreeLineage 須以
// git-common-dir 交叉驗證（候選路徑解出的 common dir === 主工作樹的 common dir）。
import { describe, it, expect } from 'vitest';
import { verifyWorktreeLineage, verifyWorktreeLineageByPath, canonicalPath } from '../../src/main/git/GitService';

// 假 svc：gitCommonDir(wsId) / gitCommonDirAt(path) → 路徑（模擬 git rev-parse --git-common-dir 結果）
function fakeSvc(map: Record<string, string | null>) {
  return {
    gitCommonDir: async (wsId: string) => map[wsId] ?? null,
    gitCommonDirAt: async (p: string) => map[p] ?? null,
  } as unknown as import('../../src/main/git/GitService').GitService;
}

describe('A2｜worktree 信任 lineage 交叉驗證', () => {
  it('候選與主工作樹 common-dir 相符 → true', async () => {
    const common = canonicalPath('C:/repos/myapp/.git');
    const svc = fakeSvc({ cand: common, main: common });
    expect(await verifyWorktreeLineage(svc, 'cand', 'main')).toBe(true);
  });

  it('候選 common-dir 指向他處（惡意偽造隸屬）→ false（不繼承信任）', async () => {
    const svc = fakeSvc({
      cand: canonicalPath('C:/attacker/evil/.git'),
      main: canonicalPath('C:/repos/myapp/.git'),
    });
    expect(await verifyWorktreeLineage(svc, 'cand', 'main')).toBe(false);
  });

  it('任一 common-dir 解不出（非 repo / rev-parse 失敗）→ false', async () => {
    const svc = fakeSvc({ cand: null, main: canonicalPath('C:/repos/myapp/.git') });
    expect(await verifyWorktreeLineage(svc, 'cand', 'main')).toBe(false);
  });
});

describe('A2/Y1｜verifyWorktreeLineageByPath（adopt handler 的真守衛）', () => {
  it('候選路徑 common-dir 相符 → true', async () => {
    const common = canonicalPath('C:/repos/myapp/.git');
    const svc = fakeSvc({ 'C:/repos/myapp-worktrees/ext': common, main: common });
    expect(await verifyWorktreeLineageByPath(svc, 'C:/repos/myapp-worktrees/ext', 'main')).toBe(true);
  });

  it('候選路徑 common-dir 指向他處（惡意登記竄改）→ false', async () => {
    const svc = fakeSvc({ 'C:/attacker/evil': canonicalPath('C:/attacker/evil/.git'), main: canonicalPath('C:/repos/myapp/.git') });
    expect(await verifyWorktreeLineageByPath(svc, 'C:/attacker/evil', 'main')).toBe(false);
  });

  it('候選路徑非 repo（gitCommonDirAt 回 null）→ false', async () => {
    const svc = fakeSvc({ main: canonicalPath('C:/repos/myapp/.git') });
    expect(await verifyWorktreeLineageByPath(svc, 'C:/random/dir', 'main')).toBe(false);
  });
});
