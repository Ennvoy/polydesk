// 檔案總管刪除 → 移到系統資源回收桶（不永久刪）+ danger 確認按鈕樣式診斷（紅底白字）。
import { test, expect } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('檔案總管刪除 → 檔案從樹消失（回收桶）+ danger 按鈕為紅底', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  writeFileSync(join(wsDir, 'del-me.txt'), 'x');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  await page.locator('[role="tree"] [role="treeitem"][aria-label="del-me.txt"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /刪除/ }).click();

  const delBtn = page.locator('button.pd-btn-danger');
  await expect(delBtn).toBeVisible();
  // danger 按鈕在三主題都應是「非透明實色背景 ≠ 白字」（不會白底白字看不見）
  for (const theme of ['dark', 'light', 'warm']) {
    const style = await delBtn.evaluate((el, t) => {
      document.documentElement.setAttribute('data-theme', t);
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    }, theme);
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)'); // 非透明
    expect(style.bg).not.toBe(style.color); // 底色 ≠ 字色（避免看不見）
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); // 復原主題

  await delBtn.click();
  await expect(page.locator('[role="tree"] [role="treeitem"][aria-label="del-me.txt"]')).toHaveCount(0);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
