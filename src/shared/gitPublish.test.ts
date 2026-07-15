import { describe, it, expect } from 'vitest';
import { publishRepoNameError, defaultRepoName } from './gitPublish';

describe('publishRepoNameError（GitHub repo 名稱驗證）', () => {
  it('合法名稱通過', () => {
    for (const n of ['polydesk', 'my-repo', 'a', 'A_b.c-d', '0.2.0-notes', 'x'.repeat(100)]) {
      expect(publishRepoNameError(n)).toBeNull();
    }
  });
  it('空白/過長被擋', () => {
    expect(publishRepoNameError('')).toMatch(/請輸入/);
    expect(publishRepoNameError('   ')).toMatch(/請輸入/);
    expect(publishRepoNameError('x'.repeat(101))).toMatch(/過長/);
  });
  it('非法字元被擋（中文、空白、斜線、shell 字元）', () => {
    for (const n of ['我的專案', 'a b', 'a/b', 'a;b', 'a$(x)', 'a`b`']) {
      expect(publishRepoNameError(n)).toMatch(/英數字/);
    }
  });
  it('開頭 . 或 -（旗標注入面）與 .git 結尾被擋', () => {
    expect(publishRepoNameError('-rf')).toMatch(/開頭/);
    expect(publishRepoNameError('.hidden')).toMatch(/開頭/);
    expect(publishRepoNameError('repo.git')).toMatch(/\.git/);
    expect(publishRepoNameError('repo.GIT')).toMatch(/\.git/);
  });
});

describe('defaultRepoName（資料夾名 → 預設 repo 名）', () => {
  it('合法名原樣保留', () => {
    expect(defaultRepoName('polydesk')).toBe('polydesk');
    expect(defaultRepoName('My_App.v2')).toBe('My_App.v2');
  });
  it('非法字元轉 -、修剪頭尾', () => {
    expect(defaultRepoName('我的終端機')).toBe('my-repo'); // 全非法 → fallback
    expect(defaultRepoName('my app (v2)')).toBe('my-app-v2');
    expect(defaultRepoName('.config-stuff')).toBe('config-stuff');
    expect(defaultRepoName('proj---')).toBe('proj');
  });
  it('空輸入 fallback', () => {
    expect(defaultRepoName('')).toBe('my-repo');
    expect(defaultRepoName('   ')).toBe('my-repo');
  });
});
