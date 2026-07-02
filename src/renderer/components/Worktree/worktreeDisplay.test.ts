// F-11 紅軍 A1：rail worktree 徽章顯示安全。分支名（含惡意 HTML/RLO）不得以原樣 HTML 注入。
// Windows 上 git 無法建含 <>|: 的分支（NTFS 檔名限制），故 XSS 的實地重現不可行；
// 防線＝React 文字節點跳脫（禁 dangerouslySetInnerHTML）＋neutralizeBidi 剝 RLO。此處以純函式＋靜態源碼守衛驗證。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { worktreeBranchDisplay } from './worktreeModel';

describe('worktreeBranchDisplay（紅軍 A1）', () => {
  it('detached(null) → 明確文字、非 "null"；載入中(undefined) → "…"', () => {
    expect(worktreeBranchDisplay(null)).toBe('(detached HEAD)');
    expect(worktreeBranchDisplay(null)).not.toBe('null');
    expect(worktreeBranchDisplay(undefined)).toBe('…');
  });

  it('RLO/雙向覆寫字元被 neutralizeBidi 剝除（防視覺偽裝 main）', () => {
    const rlo = 'x‮<gerp>'; // U+202E RIGHT-TO-LEFT OVERRIDE
    const out = worktreeBranchDisplay(rlo);
    expect(out.includes('‮')).toBe(false);
  });

  it('一般分支名原樣（不誤傷）', () => {
    expect(worktreeBranchDisplay('feat/x')).toBe('feat/x');
  });
});

describe('靜態守衛：worktree/rail 渲染路徑禁 dangerouslySetInnerHTML（紅軍 A1）', () => {
  const files = [
    'CreateWorktreeDialog.tsx',
    join('..', 'WorkspaceRail.tsx'),
  ];
  it('相關元件源碼無 dangerouslySetInnerHTML 用法 / innerHTML= 賦值（註解提及不算）', () => {
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      // 偵測「實際用法」：dangerouslySetInnerHTML={ 或 = （JSX 屬性），非註解裡的字樣。
      expect(/dangerouslySetInnerHTML\s*=/.test(src), `${f} 不得用 dangerouslySetInnerHTML`).toBe(false);
      expect(/\.innerHTML\s*=/.test(src), `${f} 不得直接寫 innerHTML`).toBe(false);
    }
  });
});
