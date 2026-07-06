// Word 文件唯讀預覽：docx → mammoth HTML（中文內文＋內嵌圖片可見）；doc → 純文字；
// 皆非 Monaco 二進位亂碼，且上方有「用系統程式開啟」按鈕。
import { test, expect } from '@playwright/test';
import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const FIXTURES = join(__dirname, '..', 'tests', 'fixtures');

test('docx 開啟為文件預覽：中文內文＋內嵌圖片＋系統開啟按鈕；doc 開啟為純文字', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  copyFileSync(join(FIXTURES, 'sample.docx'), join(wsDir, 'sample.docx'));
  copyFileSync(join(FIXTURES, 'sample.doc'), join(wsDir, 'sample.doc'));

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  // 點 docx → 文件預覽 pane（不是 Monaco 亂碼）
  await page.locator('[role="tree"] [role="treeitem"][aria-label="sample.docx"]').click();
  const doc = page.locator('[role="group"][aria-label="文件：sample.docx"]');
  await expect(doc).toBeVisible();
  await expect(doc.getByText('DOCX_FIXTURE_BODY 這是中文內文段落。')).toBeVisible({ timeout: 15000 });
  await expect(doc.locator('img[src^="data:image/png;base64"]')).toBeVisible(); // 內嵌圖片真的渲染
  await expect(doc.locator('button[aria-label="用系統程式開啟"]')).toBeVisible();

  // 點 doc（舊格式）→ 純文字預覽
  await page.locator('[role="tree"] [role="treeitem"][aria-label="sample.doc"]').click();
  const legacy = page.locator('[role="group"][aria-label="文件：sample.doc"]');
  await expect(legacy).toBeVisible();
  await expect(legacy.locator('pre')).not.toBeEmpty({ timeout: 15000 });
  await expect(legacy.getByText('僅文字，無圖片/格式')).toBeVisible();

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
