// 需求2：檔案總管右鍵編輯。真實點擊驗證「新增檔案 → 改名 → 刪除」全鏈（真 fs + 真 IPC + 真 UI）。
import { test, expect } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('檔案總管右鍵：新增檔案 → 改名 → 刪除', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  writeFileSync(join(wsDir, 'existing.txt'), 'hi'); // 預置一個檔

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  const tree = page.locator('[role="tree"]');
  await expect(tree.locator('[role="treeitem"][aria-label="existing.txt"]')).toBeVisible();

  // ① 新增檔案（header ＋ 鈕 → inline 輸入 → Enter）。
  await page.locator('button[aria-label="在根目錄新增檔案"]').click();
  const newInput = page.locator('input[aria-label="名稱"]');
  await expect(newInput).toBeFocused();
  await newInput.fill('created.txt');
  await newInput.press('Enter');
  await expect(tree.locator('[role="treeitem"][aria-label="created.txt"]')).toBeVisible();

  // ② 改名（右鍵 → 重新命名 → inline 改 → Enter）。
  await tree.locator('[role="treeitem"][aria-label="existing.txt"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /重新命名/ }).click();
  const renameInput = page.locator('input[aria-label="名稱"]');
  await expect(renameInput).toBeFocused();
  await renameInput.fill('renamed.txt');
  await renameInput.press('Enter');
  await expect(tree.locator('[role="treeitem"][aria-label="renamed.txt"]')).toBeVisible();
  await expect(tree.locator('[role="treeitem"][aria-label="existing.txt"]')).toHaveCount(0);

  // ③ 刪除（右鍵 → 刪除 → 確認框）。
  await tree.locator('[role="treeitem"][aria-label="renamed.txt"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /刪除/ }).click();
  await page.locator('button[aria-label="刪除"]').click();
  await expect(tree.locator('[role="treeitem"][aria-label="renamed.txt"]')).toHaveCount(0);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
