// 編輯器分頁依工作區分離：分頁列只列當前工作區的分頁；切工作區互不混雜、切回原工作區還原原分頁。
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('切換工作區只見該工作區分頁；切回還原原分頁與內容', async () => {
  const root = makeTempDir();
  const dirA = makeSubDir(root, 'projA');
  const dirB = makeSubDir(root, 'projB');
  writeFileSync(join(dirA, 'a.md'), 'AAA_CONTENT alpha\n');
  writeFileSync(join(dirB, 'b.md'), 'BBB_CONTENT beta\n');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dirA, dirB]);
  await addWorkspaceViaUI(page);
  await expect(page.locator('button[aria-label="開啟工作區 projA"]')).toBeVisible();
  await addWorkspaceViaUI(page);
  await expect(page.locator('button[aria-label="開啟工作區 projB"]')).toBeVisible();

  const tabA = page.locator('[role="tab"][aria-label^="a.md"]');
  const tabB = page.locator('[role="tab"][aria-label^="b.md"]');

  // 工作區 A 開 a.md
  await page.locator('button[aria-label="開啟工作區 projA"]').click();
  await page.locator('[role="tree"] [role="treeitem"][aria-label="a.md"]').click();
  await expect(tabA).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toContainText('AAA_CONTENT', { timeout: 15000 });

  // 切到工作區 B：A 的分頁不可見、編輯區回到空狀態
  await page.locator('button[aria-label="開啟工作區 projB"]').click();
  await expect(tabA).toBeHidden();
  await expect(page.getByText('尚未開啟檔案')).toBeVisible();

  // B 開 b.md：只見 b.md 分頁
  await page.locator('[role="tree"] [role="treeitem"][aria-label="b.md"]').click();
  await expect(tabB).toBeVisible();
  await expect(tabA).toBeHidden();
  await expect(page.locator('.monaco-editor').first()).toContainText('BBB_CONTENT', { timeout: 15000 });

  // 切回 A：a.md 分頁與內容還原、b.md 分頁不可見
  await page.locator('button[aria-label="開啟工作區 projA"]').click();
  await expect(tabA).toBeVisible();
  await expect(tabB).toBeHidden();
  await expect(page.locator('.monaco-editor').first()).toContainText('AAA_CONTENT', { timeout: 15000 });

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});
