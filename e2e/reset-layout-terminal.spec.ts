// 重現/驗證：開終端機後按「重設版面」，終端機面板不應被 dispose 重建（PTY session/內容/分頁全保留）。
// 決定性手法：重設前在終端機 DOM 標記屬性；若重設後同一 element（含標記）仍在＝沒 dispose（move 而非 clear）。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('開終端機 → 重設版面 → 終端機面板不被重建（分頁/PTY 保留）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-rl-'));
  const dir = join(root, 'rl-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 rl-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  const tab = page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first();
  await expect(tab).toBeVisible({ timeout: 15000 });
  const termView = page.locator('.pd-term-view').first();
  await expect(termView).toBeVisible({ timeout: 10000 });

  // 在既有終端機 DOM 上標記：重設後同一 element（含標記）仍在 ＝ 沒被 dispose 重建。
  await page.evaluate(() => document.querySelector('.pd-term-view')?.setAttribute('data-keepmark', 'K1'));

  await page.locator('button[aria-label="重設版面"]').click();

  // 分頁仍在 + 同一終端機 DOM（標記未失）仍在（clear 重建會丟標記；move 保留）。
  await expect(tab).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.pd-term-view[data-keepmark="K1"]')).toBeVisible({ timeout: 10000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
