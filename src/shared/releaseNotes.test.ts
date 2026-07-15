// 版本同步閘門：releaseNotes 頂端項目 SHALL 與 package.json version 一致——
// bump 只改其中一邊就紅燈（把「每批交付要 bump 版本」從散文變成確定性節點）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RELEASE_NOTES, APP_VERSION } from './releaseNotes';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as {
  version: string;
};

describe('releaseNotes 版本同步閘門', () => {
  it('APP_VERSION 與 package.json version 一致（bump 漏改任一邊即紅燈）', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(RELEASE_NOTES[0].version).toBe(pkg.version);
  });

  it('格式健全：semver、ISO 日期、重點非空', () => {
    for (const n of RELEASE_NOTES) {
      expect(n.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(n.date))).toBe(false);
      expect(n.highlights.length).toBeGreaterThan(0);
      for (const h of n.highlights) expect(h.trim().length).toBeGreaterThan(0);
    }
  });

  it('由新到舊排列（版本嚴格遞減、日期不遞增）', () => {
    const toNum = (v: string): number[] => v.split('.').map(Number);
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      const [a, b] = [toNum(RELEASE_NOTES[i - 1].version), toNum(RELEASE_NOTES[i].version)];
      const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(cmp).toBeGreaterThan(0);
      expect(Date.parse(RELEASE_NOTES[i - 1].date)).toBeGreaterThanOrEqual(Date.parse(RELEASE_NOTES[i].date));
    }
  });
});
