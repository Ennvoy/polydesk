// 工作區 rail：toolbar「工作區」toggle 顯隱 + 「重設版面」還原 rail 寬度回預設。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { launchApp } from './electronApp';

const railWidth = (page: Page): Promise<number> =>
  page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w'), 10));

test('工作區列可 toggle 顯隱', async () => {
  const { app, page, userData } = await launchApp();
  const rail = page.locator('aside[aria-label="工作區列表"]');
  await expect(rail).toBeVisible();

  await page.locator('button[aria-label="切換工作區列顯示"]').click();
  await expect(rail).toHaveCount(0); // 隱藏（unmount）

  await page.locator('button[aria-label="切換工作區列顯示"]').click();
  await expect(rail).toBeVisible(); // 再顯示

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});

test('重設版面也還原工作區 rail 寬度', async () => {
  const { app, page, userData } = await launchApp();
  await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible();
  expect(await railWidth(page)).toBe(240);

  // 拖寬 rail +120px
  const resizer = page.locator('.pd-rail-resizer');
  const box = await resizer.boundingBox();
  if (!box) throw new Error('找不到 rail resizer');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 10 });
  await page.mouse.up();
  expect(await railWidth(page)).toBeGreaterThan(300);

  // 重設版面 → rail 回 240
  await page.locator('button[aria-label="重設版面"]').click();
  await expect.poll(() => railWidth(page), { timeout: 3000 }).toBe(240);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
