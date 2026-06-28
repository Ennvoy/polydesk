// P-2 驗證：外殼真實渲染（非白屏）+ 三主題即時切換 + 重啟沿用（REQ-E2E-007）。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp } from './electronApp';

test('外殼渲染 + 主題即時切換 + 重啟沿用 (REQ-E2E-007)', async () => {
  const first = await launchApp();
  const { page, userData } = first;

  // 外殼真實渲染（非白屏）：活動列 / shell / dockview 容器皆可見
  await expect(page.locator('.pd-shell')).toBeVisible();
  await expect(page.locator('.pd-activitybar')).toBeVisible();
  await expect(page.locator('.polydesk-dockview')).toBeVisible();

  // 預設深色
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // 開設定 → 切淺色 → 即時套用
  await page.getByLabel('設定').click();
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  await page.getByLabel('套用淺色主題').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // 再切暖色
  await page.getByLabel('套用暖色主題').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');

  await first.app.close();

  // 重啟同一 userData → 沿用暖色（REQ-THEME-002 / REQ-E2E-007）
  const second = await launchApp({ userData });
  await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'warm');
  await second.app.close();

  rmSync(userData, { recursive: true, force: true });
});
