// 需求2：檔案總管右鍵編輯。真實點擊驗證「新增檔案 → 改名 → 刪除」全鏈（真 fs + 真 IPC + 真 UI）。
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('隱藏編輯器時點檔 → 編輯器自動顯示回來', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  writeFileSync(join(wsDir, 'hello.txt'), 'hi');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  const editorBtn = page.locator('button[aria-label="切換編輯器顯示"]');
  await expect(editorBtn).toHaveAttribute('aria-pressed', 'true'); // 預設顯示

  await editorBtn.click(); // 隱藏編輯器
  await expect(editorBtn).toHaveAttribute('aria-pressed', 'false');

  // 點檔 → 編輯器應自動顯示回來
  await page.locator('[role="tree"] [role="treeitem"][aria-label="hello.txt"]').click();
  await expect(editorBtn).toHaveAttribute('aria-pressed', 'true');

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});

test('右鍵「複製路徑／複製相對路徑」→ 系統剪貼簿真的有正確路徑（clipboard IPC，非被封鎖的 navigator.clipboard）', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  mkdirSync(join(wsDir, 'sub'), { recursive: true });
  writeFileSync(join(wsDir, 'sub', 'target.txt'), 'x');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  // 展開 sub → 右鍵 target.txt → 複製路徑 → 剪貼簿為完整 Windows 路徑
  await page.locator('[role="tree"] [role="treeitem"][aria-label="sub"]').click();
  const row = page.locator('[role="tree"] [role="treeitem"][aria-label="target.txt"]');
  await row.click({ button: 'right' });
  await page.locator('[role="menu"]').getByText('複製路徑', { exact: true }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5000 })
    .toBe(join(wsDir, 'sub', 'target.txt'));

  // 複製相對路徑 → 剪貼簿為 sub\target.txt
  await row.click({ button: 'right' });
  await page.locator('[role="menu"]').getByText('複製相對路徑', { exact: true }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5000 })
    .toBe('sub\\target.txt');

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
