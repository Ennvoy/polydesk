// F-11 worktree 對話框純邏輯單測（REQ-WT-002/005/010/011）。
// 重點：前端 branchNameError 與 main 端 validateRef 規則一致（紅軍：前後端驗證漂移＝後端才擋、體驗差）。
import { describe, it, expect } from 'vitest';
import {
  branchNameError,
  localNameFromRemote,
  checkedOutBranches,
  buildBranchSpec,
  previewTargetPath,
} from './worktreeModel';
import { validateRef } from '../../../main/git/gitSafeArgs';

describe('branchNameError ↔ main validateRef 一致性（紅軍：前後端驗證漂移）', () => {
  const cases = [
    'feat/x', 'fix-123', 'a/b/c', 'release.v2', // 合法
    '', 'HEAD', '@', 'bad name', 'feat~1', 'a:b', 'x?', 'y*', '-lead', '/lead', 'trail/',
    '.dot', 'end.', 'a..b', 'a//b', 'a@{0}', 'seg/.hidden', 'x.lock', 'refs\\win',
  ];
  it('每個輸入：branchNameError 為 null ⇔ validateRef 為 true', () => {
    for (const c of cases) {
      const feErr = branchNameError(c);
      expect(feErr === null, `front="${feErr}" vs validateRef=${validateRef(c)} for ${JSON.stringify(c)}`).toBe(
        validateRef(c),
      );
    }
  });

  it('隱形/雙向字元（U+200E）被擋', () => {
    expect(branchNameError('a‎b')).not.toBeNull();
    expect(validateRef('a‎b')).toBe(false);
  });
});

describe('localNameFromRemote', () => {
  it('origin/feat/x → feat/x；無斜線原樣', () => {
    expect(localNameFromRemote('origin/feat/x')).toBe('feat/x');
    expect(localNameFromRemote('upstream/main')).toBe('main');
    expect(localNameFromRemote('weird')).toBe('weird');
  });
});

describe('checkedOutBranches（REQ-WT-005 互斥）', () => {
  it('收集所有非 null branch；detached(null) 略過', () => {
    const s = checkedOutBranches([{ branch: 'main' }, { branch: null }, { branch: 'feat/x' }]);
    expect([...s].sort()).toEqual(['feat/x', 'main']);
  });
});

describe('buildBranchSpec（三來源）', () => {
  it('existing：帶選中分支；空→error', () => {
    expect(buildBranchSpec('existing', { existing: 'feat/x' })).toEqual({
      branch: { kind: 'existing', name: 'feat/x' },
      slugSource: 'feat/x',
    });
    expect('error' in buildBranchSpec('existing', {})).toBe(true);
  });

  it('new：驗證新名＋起點；非法名→error', () => {
    expect(buildBranchSpec('new', { newName: 'feat/y', base: 'main' })).toEqual({
      branch: { kind: 'new', name: 'feat/y', base: 'main' },
      slugSource: 'feat/y',
    });
    expect('error' in buildBranchSpec('new', { newName: 'bad name' })).toBe(true);
    expect('error' in buildBranchSpec('new', { newName: 'ok', base: 'a:b' })).toBe(true);
  });

  it('remote：本地追蹤名去 remote 前綴，base=origin/xxx', () => {
    expect(buildBranchSpec('remote', { remoteRef: 'origin/feat/z' })).toEqual({
      branch: { kind: 'remote', name: 'feat/z', base: 'origin/feat/z' },
      slugSource: 'feat/z',
    });
    expect('error' in buildBranchSpec('remote', {})).toBe(true);
  });
});

describe('previewTargetPath（sibling + slug）', () => {
  it('主 repo 上層 + <repo>-worktrees + slug（斜線→連字號；平台分隔符）', () => {
    const p = previewTargetPath('C:/repos/myapp', 'feat/x');
    // 平台中立斷言：結尾為 <sep>myapp-worktrees<sep>feat-x（Windows \、POSIX /）
    expect(p).toMatch(/[\\/]myapp-worktrees[\\/]feat-x$/);
    expect(p).not.toContain('feat/x'); // slug 已把 / 轉 -
  });
});
