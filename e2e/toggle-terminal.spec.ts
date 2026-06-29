// toolbar「終端機」按鈕顯隱：隱藏＝removePanel 真騰出空間、終端機 session（PTY）不殺、再開自動接回 pane。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('toggle 終端機顯隱：隱藏騰出空間、再開終端機 session 接回', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-tg-'));
  const dir = join(root, 'tg-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 tg-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  const tab = page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first();
  await expect(tab).toBeVisible({ timeout: 15000 });

  const toggleBtn = page.locator('button[aria-label="切換終端機顯示"]');
  await toggleBtn.click(); // 隱藏（removePanel）→ 真的騰出空間
  await expect(page.locator('button[aria-label="新增終端機"]')).toBeHidden({ timeout: 8000 });

  await toggleBtn.click(); // 再開 → 終端機 session（PTY）接回、pane 重現
  await expect(tab).toBeVisible({ timeout: 10000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
