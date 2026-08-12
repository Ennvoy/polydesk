import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

describe('portable 啟動畫面封裝契約', () => {
  it('不設定靜態自解壓 splash，只保留 Electron 動畫啟動畫面', () => {
    expect(packageJson.build.portable).not.toHaveProperty('splashImage');
  });
});
