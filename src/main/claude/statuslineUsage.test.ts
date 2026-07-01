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

  it('既有 statusline.ps1 為 UTF-16LE：保留編碼注入、中文不亂碼（codex P1-2）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-sl-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    const script = 'Write-Output "早安"\n'; // 含中文，UTF-16LE + BOM
    writeFileSync(slPath(home), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, 'utf16le')]));
    try {
      expect((await installStatuslineUsage(home)).changed).toBe(true);
      const buf = readFileSync(slPath(home));
      expect([buf[0], buf[1]]).toEqual([0xff, 0xfe]); // 仍是 UTF-16LE BOM（沒被轉成 UTF-8）
      const text = buf.toString('utf16le').replace(/^﻿/, '');
      expect(text).toContain('Write-Output "早安"'); // 中文原內容完好、未亂碼
      expect(text).toContain('POLYDESK-USAGE-BEGIN');
      // 備份也是原編碼
      expect(readFileSync(`${slPath(home)}.polydesk-usage-bak`).toString('utf16le').replace(/^﻿/, '')).toContain('早安');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('既有 statusline.ps1 為非 UTF-8/UTF-16（Big5 位元組）：跳過注入、原檔 byte-identical', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-sl-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    const big5 = Buffer.from([0x41, 0xa6, 0x63, 0x0a]); // 'A' + 一個 Big5 雙位元組 + \n（非合法 UTF-8、無 BOM）
    writeFileSync(slPath(home), big5);
    try {
      expect((await installStatuslineUsage(home)).changed).toBe(false); // 不冒險 → 跳過
      expect(readFileSync(slPath(home)).equals(big5)).toBe(true); // 原檔一位元組都沒動
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
