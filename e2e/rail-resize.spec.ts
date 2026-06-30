// 問題 A：工作區欄（rail）本來寬度固定無法調整 → 新增可拖曳分隔條 + 寬度持久化。
// 驗證：拖曳分隔條把 rail 拉寬 → --rail-w 變大且在 MIN/MAX 內 → 重啟同 userData 還原成關閉前寬度。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { launchApp } from './electronApp';

const railWidth = (page: Page): Promise<number> =>
  page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w'), 10));

test('工作區欄可拖曳調寬 + 重啟持久化', async () => {
  const first = await launchApp();
  const { page, userData } = first;
  await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible();

  const before = await railWidth(page);
  expect(before).toBe(240); // tokens.css 預設 --rail-w

  // 拖曳分隔條往右 +120px（pointer down→move→up）。
  const resizer = page.locator('.pd-rail-resizer');
  await expect(resizer).toBeVisible();
  const box = await resizer.boundingBox();
  if (!box) throw new Error('找不到 rail resizer');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 10 });
  await page.mouse.up();

  const after = await railWidth(page);
  expect(after).toBeGreaterThan(before + 80); // 確實被拉寬
  expect(after).toBeLessThanOrEqual(480); // 不超過 MAX
  await first.app.close();

  // 重啟同 userData → 持久化還原（RailResizer 掛載時 async 讀回，poll 等套用）。
  const second = await launchApp({ userData });
  await expect(second.page.locator('aside[aria-label="工作區列表"]')).toBeVisible();
  await expect
    .poll(() => railWidth(second.page), { timeout: 5000 })
    .toBeGreaterThan(before + 80); // 還原成關閉前的「拉寬後」寬度，而非回到 240
  await second.app.close();

  rmSync(userData, { recursive: true, force: true });
});
