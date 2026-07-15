// 版本可視化（PE-3）：說明選單「關於 Polydesk」與狀態列版本鈕，版本號與 package.json 對賬
// （版本唯一來源 shared/releaseNotes；單測擋同步，本測驗證真 UI 鏈路實際顯示）。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './electronApp';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };

test('說明 → 關於 Polydesk：版本號與近版重點；狀態列版本鈕同鏈路', async () => {
  const { app, page, userData } = await launchApp();
  try {
    // 標題列「說明」選單 → 關於 Polydesk
    await page.locator('.pd-titlebar-menubtn', { hasText: '說明' }).click();
    await page.locator('.pd-titlebar-item', { hasText: '關於 Polydesk' }).click();
    await expect(page.getByRole('heading', { name: 'Polydesk', exact: true })).toBeVisible();
    await expect(page.getByLabel(`目前版本 v${pkg.version}`)).toBeVisible(); // 顯示版本＝package.json 版本
    await expect(page.getByLabel('近期版本更新重點')).toBeVisible();
    await page.getByRole('button', { name: '關閉關於視窗' }).click();
    await expect(page.getByRole('heading', { name: 'Polydesk', exact: true })).toHaveCount(0);

    // 狀態列右下常駐版本鈕 → 同一個關於視窗
    const verBtn = page.locator('.pd-statusbar-version');
    await expect(verBtn).toHaveText(`v${pkg.version}`);
    await verBtn.click();
    await expect(page.getByLabel(`目前版本 v${pkg.version}`)).toBeVisible();
    await page.getByRole('button', { name: '關閉關於視窗' }).click();
  } finally {
    await app.close().catch(() => undefined);
    const { rmSync } = await import('node:fs');
    rmSync(userData, { recursive: true, force: true });
  }
});
