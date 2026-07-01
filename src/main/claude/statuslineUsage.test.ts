// statuslineUsage 注入：注入 usage 段（marker+寫 usage.json）、冪等、備份、remove 還原、無檔略過。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installStatuslineUsage, removeStatuslineUsage } from './statuslineUsage';

function setup(script: string): string {
  const home = mkdtempSync(join(tmpdir(), 'pd-sl-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'statusline.ps1'), script);
  return home;
}
const slPath = (home: string): string => join(home, '.claude', 'statusline.ps1');

describe('statuslineUsage', () => {
  it('注入 usage 段（marker + 寫 usage.json），保留原內容，冪等', async () => {
    const home = setup('$j = $stdin | ConvertFrom-Json\nWrite-Output "hi"\n');
    try {
      const r1 = await installStatuslineUsage(home);
      expect(r1.changed).toBe(true);
      const c = readFileSync(slPath(home), 'utf8');
      expect(c).toContain('POLYDESK-USAGE-BEGIN');
      expect(c).toContain('usage.json');
      expect(c).toContain('rate_limits');
      expect(c).toContain('Write-Output "hi"'); // 原內容保留
      const r2 = await installStatuslineUsage(home);
      expect(r2.changed).toBe(false); // 冪等：不重複注入
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('首次注入前備份原檔', async () => {
    const home = setup('original statusline content\n');
    try {
      await installStatuslineUsage(home);
      expect(readFileSync(`${slPath(home)}.polydesk-usage-bak`, 'utf8')).toBe('original statusline content\n');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('remove 移除注入段、還原原內容', async () => {
    const home = setup('$j = $stdin | ConvertFrom-Json\nWrite-Output "hi"\n');
    try {
      await installStatuslineUsage(home);
      const rm = await removeStatuslineUsage(home);
      expect(rm.changed).toBe(true);
      const c = readFileSync(slPath(home), 'utf8');
      expect(c).not.toContain('POLYDESK-USAGE');
      expect(c).toContain('Write-Output "hi"');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('無 statusline.ps1 → 略過（不建檔、不報錯）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-sl-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    try {
      expect((await installStatuslineUsage(home)).changed).toBe(false);
      expect(existsSync(slPath(home))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
