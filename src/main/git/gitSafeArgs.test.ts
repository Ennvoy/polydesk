// F-7 紅軍 A1：validateRef 白名單（拒 refspec/路徑語意注入）+ read/write 硬化 helpers（A2/A4 基礎）。

import { describe, it, expect } from 'vitest';
import {
  validateRef,
  readHardeningArgs,
  readEnv,
  writeEnv,
  networkEnv,
  literalPathspec,
  withPathspecs,
} from './gitSafeArgs';

describe('validateRef 白名單（A1：注入字串一律 false）', () => {
  const malicious = [
    'main:refs/heads/x', // src:dst refspec → 任意 ref 覆寫
    '+main', // force refspec 標記
    '@{0}', // reflog 語意
    'x.lock', // ref lock 檔名
    '..',
    '-foo', // 被當選項
    'HEAD',
    '@',
    'a b', // 空白
    'a~1',
    'a^',
    'a:b',
    'a?',
    'a*',
    'a[',
    'a\\b',
    '\u0001x', // 控制字元（U+0001）
    '',
    'refs/heads/../x',
    'A'.repeat(4096), // 超長
    '\u202eevil', // 雙向覆寫
    'a//b',
    '/lead',
    'trail/',
    '.hidden',
    'end.',
    'feature/.x',
    'feature/x.lock',
  ];
  for (const n of malicious) {
    it(`拒 ${JSON.stringify(n)}`, () => {
      expect(validateRef(n)).toBe(false);
    });
  }

  const legal = ['feature/x', 'release-1.2', 'main', 'dev', 'fix_123', 'a/b/c', '中文分支'];
  for (const n of legal) {
    it(`允許 ${JSON.stringify(n)}`, () => {
      expect(validateRef(n)).toBe(true);
    });
  }

  it('非字串輸入一律 false', () => {
    expect(validateRef(undefined)).toBe(false);
    expect(validateRef(null)).toBe(false);
    expect(validateRef(123 as unknown)).toBe(false);
    expect(validateRef({} as unknown)).toBe(false);
  });
});

describe('read 類硬化 helpers（A2）', () => {
  it('readHardeningArgs 關 fsmonitor/hooks/pager + quotePath=false', () => {
    const a = readHardeningArgs();
    expect(a).toContain('core.fsmonitor=false');
    expect(a).toContain('core.hooksPath=');
    expect(a).toContain('core.pager=');
    expect(a).toContain('core.quotePath=false');
    expect(a).toContain('--no-pager');
  });

  it('readEnv 禁 system/global + 關 optional locks + 關終端提示', () => {
    const e = readEnv();
    expect(e.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(e.GIT_OPTIONAL_LOCKS).toBe('0');
    expect(e.GIT_TERMINAL_PROMPT).toBe('0');
    expect(typeof e.GIT_CONFIG_GLOBAL).toBe('string');
    expect((e.GIT_CONFIG_GLOBAL ?? '').length).toBeGreaterThan(0);
  });

  it('writeEnv 仍禁 system 但保留 global（commit 需身分）+ 關終端提示', () => {
    const e = writeEnv();
    expect(e.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(e.GIT_TERMINAL_PROMPT).toBe('0');
    expect(e.GIT_CONFIG_GLOBAL).toBeUndefined();
  });

  it('networkEnv 放行 system（GCM credential helper 可用）但仍以 env-config 覆蓋 fsmonitor + 關終端提示', () => {
    const e = networkEnv();
    expect(e.GIT_CONFIG_NOSYSTEM).toBeUndefined(); // 不禁 system → Git for Windows 的 GCM 啟用設定可被讀到
    expect(e.GIT_TERMINAL_PROMPT).toBe('0'); // 仍不卡互動式 terminal 認證（GCM 走 GUI、不受此影響）
    expect(e.GIT_CONFIG_KEY_0).toBe('core.fsmonitor'); // 惡意 fsmonitor 仍被最高優先序 env-config 覆蓋
    expect(e.GIT_CONFIG_VALUE_0).toBe('false');
  });
});

describe('literal pathspec（A4：magic 不生效）', () => {
  it('使用者路徑包成 :(literal)', () => {
    expect(literalPathspec('a b.txt')).toBe(':(literal)a b.txt');
    expect(literalPathspec(':(exclude)secret')).toBe(':(literal):(exclude)secret');
  });

  it('withPathspecs 在 base 後接 -- 與 literal paths', () => {
    expect(withPathspecs(['add'], ['a', 'b'])).toEqual([
      'add',
      '--',
      ':(literal)a',
      ':(literal)b',
    ]);
  });
});
