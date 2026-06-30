// 問題3 迴歸：關閉編輯器（toggle editor → group.setVisible(false)，不再 removePanel/flatten/re-parent 終端機）後，
// 終端機原地存活（同一 DOM、未重建）+ 版面正常；杜絕「關編輯器→終端機 re-parent→reflow cols≈1→ConPTY 窄欄
// 橫幅瀑布」。配合 TerminalView 的 ResizeObserver 去抖 + 極窄寬守衛（code 層防禦縱深）構成雙保險。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('關閉編輯器：終端機原地存活、不重建、版面正常（問題3 迴歸）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-et-'));
  const dir = join(root, 'et-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 et-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  const pane = page.locator('.pd-term-view').first();
  await expect(pane).toBeVisible({ timeout: 15000 });
  // 標記終端機 DOM：關編輯器後同一 element 仍在 = 未 re-parent/重建（問題3 根因鏈關鍵）。
  await page.evaluate(() => document.querySelector('.pd-term-view')?.setAttribute('data-keepmark', 'ET1'));

  const editorToggle = page.locator('button[aria-label="切換編輯器顯示"]');
  await editorToggle.click(); // 關閉編輯器 → setVisible(false)，不 flatten
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  // 終端機未被 dispose/重建（同一 DOM 標記仍在）+ 寬度仍正常（未被擠成窄欄）。
  await expect(page.locator('.pd-term-view[data-keepmark="ET1"]')).toBeVisible({ timeout: 8000 });
  const wAfter = (await pane.boundingBox())?.width ?? 0;
  expect(wAfter, '關編輯器後終端機寬度應維持正常（非窄欄）').toBeGreaterThan(100);

  await editorToggle.click(); // 重新顯示編輯器
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(page.locator('.pd-term-view[data-keepmark="ET1"]')).toBeVisible({ timeout: 8000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
