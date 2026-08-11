import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

describe('portable 啟動畫面封裝契約', () => {
  it('使用 420×230、24-bit RGB BMP 作為自解壓 splash', () => {
    const splashPath = packageJson.build.portable.splashImage;
    expect(splashPath).toBe('build/portable-splash.bmp');

    const bitmap = readFileSync(join(process.cwd(), splashPath));
    expect(bitmap.subarray(0, 2).toString('ascii')).toBe('BM');
    expect(bitmap.readInt32LE(18)).toBe(420);
    expect(bitmap.readInt32LE(22)).toBe(230);
    expect(bitmap.readUInt16LE(28)).toBe(24);
  });
});
