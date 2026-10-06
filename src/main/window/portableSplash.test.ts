import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import packageJson from '../../../package.json';

describe('portable 啟動畫面封裝契約', () => {
  it('自解壓期間顯示 420×230、24-bit RGB BMP', () => {
    expect(packageJson.build.portable).toHaveProperty('splashImage', 'build/portable-splash.bmp');
    const bmp = readFileSync(join(__dirname, '../../../build/portable-splash.bmp'));
    expect(bmp.toString('ascii', 0, 2)).toBe('BM');
    expect(bmp.readInt32LE(18)).toBe(420);
    expect(bmp.readInt32LE(22)).toBe(230);
    expect(bmp.readUInt16LE(28)).toBe(24);
    expect(bmp.readUInt32LE(30)).toBe(0);
  });
});
