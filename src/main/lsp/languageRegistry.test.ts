// F-5 languageRegistry 單元測試：副檔名 → 語言伺服器對映正確、查詢函式 robust。

import { describe, it, expect } from 'vitest';
import { byExt, byLangId, byPath, SUPPORTED_LANG_IDS } from './languageRegistry';

describe('languageRegistry：副檔名 → 伺服器對映（REQ-EDIT-003）', () => {
  it.each([
    ['py', 'python', 'pyright'],
    ['pyi', 'python', 'pyright'],
    ['go', 'go', 'gopls'],
    ['rs', 'rust', 'rust-analyzer'],
    ['c', 'c', 'clangd'],
    ['h', 'c', 'clangd'],
    ['cpp', 'cpp', 'clangd'],
    ['hpp', 'cpp', 'clangd'],
    ['cc', 'cpp', 'clangd'],
    ['java', 'java', 'jdtls'],
    ['cs', 'csharp', 'csharp-ls'],
  ])('.%s → langId=%s serverId=%s', (ext, langId, serverId) => {
    const d = byExt(ext);
    expect(d).toBeDefined();
    expect(d?.langId).toBe(langId);
    expect(d?.serverId).toBe(serverId);
  });

  it('含前導點 / 大小寫不敏感', () => {
    expect(byExt('.RS')?.serverId).toBe('rust-analyzer');
    expect(byExt('.Go')?.langId).toBe('go');
  });

  it('未支援副檔名 → undefined（不擋路）', () => {
    expect(byExt('txt')).toBeUndefined();
    expect(byExt('')).toBeUndefined();
    expect(byExt('exe')).toBeUndefined();
  });

  it('byPath 由路徑取副檔名解析', () => {
    expect(byPath('C:\\proj\\src\\main.rs')?.serverId).toBe('rust-analyzer');
    expect(byPath('a/b/c.go')?.langId).toBe('go');
    expect(byPath('Makefile')).toBeUndefined();
  });

  it('byLangId 未知回 undefined；cmd 為裸名（解析絕對路徑前不可含分隔符）', () => {
    expect(byLangId('nope')).toBeUndefined();
    for (const langId of SUPPORTED_LANG_IDS) {
      const d = byLangId(langId);
      expect(d).toBeDefined();
      // 裸執行檔名：不得含路徑分隔（A2 — 由 serverProbe 解析成絕對路徑後才 spawn）
      expect(d?.cmd).not.toMatch(/[\\/]/);
      expect(d?.cmd.length).toBeGreaterThan(0);
    }
  });

  it('installable 者必附 installCmd；非 installable 者必附 installHint', () => {
    for (const langId of SUPPORTED_LANG_IDS) {
      const d = byLangId(langId)!;
      if (d.installable) expect(d.installCmd).toBeDefined();
      expect(typeof d.installHint).toBe('string');
      expect(d.installHint.length).toBeGreaterThan(0);
    }
  });
});
