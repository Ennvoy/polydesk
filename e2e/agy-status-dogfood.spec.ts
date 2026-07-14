// 真實 Agy 狀態 smoke test：不送 prompt、不呼叫模型、不消耗額度。
import { expect, test } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorkspaceViaUI, launchApp, stubFolderPicker } from './electronApp';

test.skip(process.env.POLYDESK_DOGFOOD_AGY_STATUS !== '1', '需要本機已安裝並登入 Agy');
test.setTimeout(90_000);

test('真實 Agy 啟動停在輸入列顯示已停止，離開後回未啟動', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-agy-status-'));
  const dir = join(root, 'agy-status-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 agy-status-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await page.locator('.pd-term-view').first().click();
    await page.keyboard.type('agy');
    await page.keyboard.press('Enter');

    const stopped = page.getByRole('status', { name: 'Agy 狀態：已停止' });
    await expect(stopped).toBeVisible({ timeout: 35_000 });

    await page.locator('.pd-term-tab-close').click();
    await expect(stopped).toHaveCount(0, { timeout: 35_000 });
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
