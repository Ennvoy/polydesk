import { test, expect, type Locator } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp } from './electronApp';

async function panelSize(group: Locator): Promise<{ width: number; height: number }> {
  const box = await group.boundingBox();
  if (!box) throw new Error('找不到 dockview panel 尺寸');
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

function expectSameSize(
  actual: { width: number; height: number },
  expected: { width: number; height: number },
): void {
  expect(Math.abs(actual.width - expected.width), '側欄寬度應維持').toBeLessThanOrEqual(1);
  expect(Math.abs(actual.height - expected.height), '側欄高度應維持').toBeLessThanOrEqual(1);
}

test('dockview 標頭 × 原地隱藏編輯器或終端機，側欄尺寸維持', async () => {
  const { app, page, userData } = await launchApp();
  const editorToggle = page.locator('button[aria-label="切換編輯器顯示"]');
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 12000 });

  const sidebarGroup = page.locator('.dv-groupview', {
    has: page.locator('.dv-default-tab-content', { hasText: '側欄' }),
  });
  const editorDockTab = page.locator('.dv-tab', {
    has: page.locator('.dv-default-tab-content', { hasText: '編輯器' }),
  });
  await expect(sidebarGroup).toBeVisible();
  const before = await panelSize(sidebarGroup);

  await editorDockTab.locator('.dv-default-tab-action').click();
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  expectSameSize(await panelSize(sidebarGroup), before);

  await editorToggle.click();
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  expectSameSize(await panelSize(sidebarGroup), before);

  const terminalToggle = page.locator('button[aria-label="切換終端機顯示"]');
  const terminalDockTab = page.locator('.dv-tab', {
    has: page.locator('.dv-default-tab-content', { hasText: '終端機' }),
  });
  const terminalPanel = page.locator('.pd-term-panel, .pd-term-empty');
  await expect(terminalPanel).toHaveCount(1);
  await terminalDockTab.locator('.dv-default-tab-action').click();
  await expect(terminalToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  await expect(terminalPanel).toHaveCount(1);
  expectSameSize(await panelSize(sidebarGroup), before);

  await terminalToggle.click();
  await expect(terminalToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(terminalPanel).toBeVisible({ timeout: 8000 });
  expectSameSize(await panelSize(sidebarGroup), before);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
