// P-4 worktreePath 純函式單測（REQ-WT-010/015）：slug 規則（Windows 保留名/長度/非法字元）、
// 序號策略、目標路徑驗證（禁工作區內部/系統目錄/超長）。
import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { branchSlug, defaultWorktreeBase, resolveTargetPath, validateWorktreeTarget } from './worktreePath';

describe('branchSlug（REQ-WT-015）', () => {
  it('斜線轉連字號：feat/x → feat-x', () => {
    expect(branchSlug('feat/x')).toBe('feat-x');
    expect(branchSlug('a/b/c')).toBe('a-b-c');
  });

  it('剔除 Windows 非法檔名字元（<>:"|?* 與控制字元）', () => {
    expect(branchSlug('a<b>c:d"e|f?g*h')).toBe('abcdefgh');
  });

  it('長度上限 60：超長截斷', () => {
    const long = 'x'.repeat(80);
    expect(branchSlug(long)).toHaveLength(60);
  });

  it('Windows 保留名前綴 wt-（大小寫不敏感、含副檔名形式）', () => {
    expect(branchSlug('CON')).toBe('wt-CON');
    expect(branchSlug('com3')).toBe('wt-com3');
    expect(branchSlug('nul.hotfix')).toBe('wt-nul.hotfix');
    expect(branchSlug('console')).toBe('console'); // 非保留（僅完整名/名.副檔名算）
  });

  it('結尾的點/空白剔除（Windows 資料夾名限制）；空結果退 wt', () => {
    expect(branchSlug('fix.')).toBe('fix');
    expect(branchSlug('***')).toBe('wt');
  });
});

describe('defaultWorktreeBase / resolveTargetPath（sibling 慣例＋序號）', () => {
  it('sibling 目錄：<repo 上層>/<repo 名>-worktrees', () => {
    const main = resolve('C:/repos/myapp');
    expect(defaultWorktreeBase(main)).toBe(resolve('C:/repos/myapp-worktrees'));
  });

  it('無衝突用原名；已存在自動加 -2、-3（REQ-WT-010 序號策略）', () => {
    const base = resolve('C:/repos/myapp-worktrees');
    const taken = new Set([join(base, 'feat-x'), join(base, 'feat-x-2')]);
    const exists = (p: string): boolean => taken.has(p);
    expect(resolveTargetPath(base, 'feat-y', () => false)).toBe(join(base, 'feat-y'));
    expect(resolveTargetPath(base, 'feat-x', exists)).toBe(join(base, 'feat-x-3'));
  });
});

describe('validateWorktreeTarget（REQ-WT-015 安全）', () => {
  const wsA = resolve('C:/repos/myapp');
  const workspaces = [wsA];

  it('合法 sibling 路徑 → ok + 正規化絕對路徑', () => {
    const r = validateWorktreeTarget('C:/repos/myapp-worktrees/feat-x', workspaces);
    expect(r).toEqual({ ok: true, abs: resolve('C:/repos/myapp-worktrees/feat-x') });
  });

  it('指向既有工作區內部 → 拒（inside-workspace）', () => {
    const r = validateWorktreeTarget(join(wsA, 'sub', 'wt'), workspaces);
    expect(r).toEqual({ ok: false, reason: 'inside-workspace' });
  });

  it('系統目錄（Windows 目錄/磁碟根）→ 拒（system）', () => {
    expect(validateWorktreeTarget('C:\\Windows\\wt', workspaces)).toEqual({ ok: false, reason: 'system' });
    expect(validateWorktreeTarget('C:\\', workspaces)).toEqual({ ok: false, reason: 'system' });
  });

  it('完整路徑 >240 字元 → 拒（too-long）', () => {
    const long = 'C:/repos/' + 'a'.repeat(240);
    expect(validateWorktreeTarget(long, workspaces)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('非字串/空 → 拒（invalid）', () => {
    expect(validateWorktreeTarget('', workspaces)).toEqual({ ok: false, reason: 'invalid' });
  });
});
