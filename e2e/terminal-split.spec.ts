// #7 終端機多開並排/上下：開兩個終端機同時顯示（非 tab 切換）+ 可拖曳分隔條 + 並排↔上下切換 + 關閉。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('多開終端機 → 並排同時顯示 + 拖曳分隔條 + 切上下 + 關閉', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-split-'));
  const dir = join(root, 'split-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 split-ws"]').click();

  // 開兩個終端機
  await page.locator('button[aria-label="新增終端機"]').click();
  await page.locator('button[aria-label="新增終端機"]').click();

  // 兩個終端機「同時」顯示（不是 tab 切換）。
  await expect(page.locator('.pd-term-view')).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator('.pd-term-view').nth(0)).toBeVisible();
  await expect(page.locator('.pd-term-view').nth(1)).toBeVisible();

  // 預設並排（左右）→ 直立可拖曳分隔條。
  await expect(page.locator('.pd-term-handle-h')).toBeVisible({ timeout: 8000 });

  // 切換為上下排列 → 橫向分隔條。
  await page.locator('button[aria-label="切換為上下排列"]').click();
  await expect(page.locator('.pd-term-handle-v')).toBeVisible({ timeout: 8000 });

  // 關閉其中一個 → 剩一個。
  await page.locator('.pd-term-pane-head .pd-term-tab-close').first().click();
  await expect(page.locator('.pd-term-view')).toHaveCount(1, { timeout: 10000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
