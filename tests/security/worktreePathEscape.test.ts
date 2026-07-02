// 紅軍 A1（high）：worktree 目標路徑逃逸——junction/symlink、大小寫變體、UNC/裝置前綴、
// 8.3 短名不得把目標「偽裝」到系統目錄/工作區外。validateWorktreeTarget 須 realpath 祖先鏈解析。
import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { validateWorktreeTarget } from '../../src/main/git/worktreePath';

const isWin = process.platform === 'win32';

describe('A1｜worktree 路徑逃逸防禦（realpath 祖先鏈）', () => {
  const wsMain = resolve('C:/repos/myapp');
  const ws = [wsMain];

  it('junction/symlink 指向系統目錄 → 解析後判 system（不信 lexical）', () => {
    // 注入 io：link 存在且 realpath 解到 C:\Windows
    const linkPath = resolve('C:/repos/myapp-worktrees/link');
    const io = {
      exists: (p: string) => p === linkPath || p === resolve('C:/repos/myapp-worktrees'),
      realpath: (p: string) => (p === linkPath ? 'C:\\Windows' : p),
    };
    const r = validateWorktreeTarget(join(linkPath, 'evil'), ws, { io });
    expect(r).toEqual({ ok: false, reason: 'system' });
  });

  it('symlink 祖先指向既有工作區內部 → 判 inside-workspace', () => {
    const linkBase = resolve('C:/tmp/wtlink');
    const io = {
      exists: (p: string) => p === linkBase,
      realpath: (p: string) => (p === linkBase ? wsMain : p),
    };
    const r = validateWorktreeTarget(join(linkBase, 'sub'), ws, { io });
    expect(r).toEqual({ ok: false, reason: 'inside-workspace' });
  });

  it('UNC / 裝置前綴（\\\\?\\、\\\\.\\、\\\\server\\share）一律拒 invalid', () => {
    for (const p of ['\\\\?\\C:\\Windows\\x', '\\\\.\\NUL', '\\\\server\\share\\wt', '//server/share/wt']) {
      expect(validateWorktreeTarget(p, ws)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('大小寫變體（win32）指向工作區內部仍判 inside-workspace', () => {
    if (!isWin) return; // 大小寫不敏感僅 win32
    const r = validateWorktreeTarget('C:/REPOS/MYAPP/sub/wt', ws);
    expect(r).toEqual({ ok: false, reason: 'inside-workspace' });
  });

  it('blockedDirs（如 app userData）內 → 判 system', () => {
    const userData = resolve('C:/Users/u/AppData/Roaming/Polydesk');
    const r = validateWorktreeTarget(join(userData, 'wt'), ws, { blockedDirs: [userData] });
    expect(r).toEqual({ ok: false, reason: 'system' });
  });

  it('乾淨 sibling 路徑（祖先 realpath 無異）→ ok', () => {
    const target = resolve('C:/repos/myapp-worktrees/feat-x');
    const io = { exists: (_p: string) => false, realpath: (p: string) => p };
    expect(validateWorktreeTarget(target, ws, { io })).toEqual({ ok: true, abs: target });
  });
});
