// P-2 驗證：外殼真實渲染（非白屏）+ 三主題即時切換 + 重啟沿用（REQ-E2E-007）。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp } from './electronApp';

test('外殼渲染 + 主題即時切換 + 重啟沿用 (REQ-E2E-007)', async () => {
  const first = await launchApp();
  const { page, userData } = first;

  // 外殼真實渲染（非白屏）：舊活動列已完整移除，入口整合到工作區標頭。
  await expect(page.locator('.pd-shell')).toBeVisible();
  await expect(page.locator('.pd-activitybar')).toHaveCount(0);
  await expect(page.locator('.pd-workspace-toolbar')).toBeVisible();
  await expect(page.getByRole('button', { name: '檔案總管', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '搜尋', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '原始碼控制', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '設定', exact: true })).toBeVisible();
  await expect(page.locator('.polydesk-dockview')).toBeVisible();
  const shellBox = await page.locator('.pd-shell').boundingBox();
  const workspaceBox = await page.locator('aside[aria-label="工作區列表"]').boundingBox();
  expect(shellBox?.x).toBe(0);
  expect(workspaceBox?.x).toBe(0);

  // 搬移後仍是真正可操作的三態切換，active／焦點狀態與無障礙名稱不退化。
  const explorer = page.getByRole('button', { name: '檔案總管', exact: true });
  const search = page.getByRole('button', { name: '搜尋', exact: true });
  const scm = page.getByRole('button', { name: '原始碼控制', exact: true });
  await expect(explorer).toHaveAttribute('aria-pressed', 'true');
  await search.click();
  await expect(search).toHaveAttribute('aria-pressed', 'true');
  const replaceToggle = page.getByRole('button', { name: '顯示取代欄' });
  await expect(replaceToggle).toHaveClass(/pd-compact-icon-btn/);
  expect(await replaceToggle.evaluate((button) => {
    const style = getComputedStyle(button);
    return { border: style.borderStyle, cursor: style.cursor };
  })).toEqual({ border: 'none', cursor: 'pointer' });
  await scm.click();
  await expect(scm).toHaveAttribute('aria-pressed', 'true');
  await explorer.click();
  await expect(explorer).toHaveAttribute('aria-pressed', 'true');
  await search.focus();
  await expect(search).toBeFocused();

  // 預設深色
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // 開設定 → 切淺色 → 即時套用
  await page.getByRole('button', { name: '設定', exact: true }).click();
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
