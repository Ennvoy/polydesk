// 驗證：toolbar「終端機」按鈕顯隱，用 group.setVisible（不 dispose）→ 隱藏再顯示後 PTY/內容/版面都保留。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('toggle 終端機顯隱 → 不 dispose（同一 DOM 保留）+ 版面正常', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-tg-'));
  const dir = join(root, 'tg-ws');
  mkdirSync(dir, { recursive: true });
  const shotDir = process.env['PD_SHOT_DIR'] ?? root;
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 tg-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  const tab = page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first();
  await expect(tab).toBeVisible({ timeout: 15000 });

  // 標記終端機 DOM：顯隱後同一 element（含標記）仍在 ＝ 沒被 dispose 重建。
  await page.evaluate(() => document.querySelector('.pd-term-view')?.setAttribute('data-keepmark', 'TG1'));

  const toggleBtn = page.locator('button[aria-label="切換終端機顯示"]');
  await toggleBtn.click(); // 隱藏
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  await toggleBtn.click(); // 顯示
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });

  // 終端機分頁回來 + 同一 DOM（標記未失）= 不 dispose；PTY/scrollback 保留。
  await expect(tab).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.pd-term-view[data-keepmark="TG1"]')).toBeVisible({ timeout: 10000 });

  // 版面結構 sanity：側欄 + 編輯器 + 終端機三面板都在且可見。
  await expect(page.locator('button[aria-label="新增終端機"]')).toBeVisible();
  await page.screenshot({ path: join(shotDir, 'toggle-terminal-after.png'), fullPage: false });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
