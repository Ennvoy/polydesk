// 圖片唯讀預覽：點 png → 圖片分頁真的渲染出像素（naturalWidth>0）＋尺寸/大小資訊列＋縮放切換。
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

test('png 開啟為圖片預覽（非 Monaco 亂碼），像素真的載入', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  writeFileSync(join(wsDir, 'dot.png'), PNG_1PX);

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  await page.locator('[role="tree"] [role="treeitem"][aria-label="dot.png"]').click();
  const pane = page.locator('[role="group"][aria-label="圖片：dot.png"]');
  await expect(pane).toBeVisible();

  const img = pane.locator('img');
  await expect(img).toBeVisible({ timeout: 10000 });
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1); // 真的解碼出 1×1
  await expect(pane.getByText('1 × 1')).toBeVisible(); // 尺寸資訊列
  await expect(pane.locator('button[aria-label="以實際大小顯示"]')).toBeVisible(); // 縮放切換

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
