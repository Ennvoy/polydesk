// Dogfood UI 回饋驗證（真實鏈路，非 mock）：
//  #2 自訂無框標題列（品牌 + 檔案/編輯/檢視 選單 + 視窗鈕）
//  #3 版面工具列「編輯器」顯隱切換鈕
//  #1 git 歷史 commit 線圖（加入本 repo＝真 git 歷史，經真 IPC → 真 git log → SVG 線圖）
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const shotDir = process.env.PD_SHOT_DIR || process.cwd();
const shot = (n: string): string => join(shotDir, n);

test('dogfood：自訂標題列 + 編輯器切換鈕 + git 線圖', async () => {
  const { app, page, userData } = await launchApp();

  // ── #2 自訂無框標題列 ──
  await expect(page.locator('.pd-titlebar')).toBeVisible();
  await expect(page.locator('.pd-titlebar-title')).toHaveText('Polydesk');
  for (const label of ['檔案', '編輯', '檢視']) {
    await expect(page.locator('.pd-titlebar-menubtn', { hasText: label })).toBeVisible();
  }
  await expect(page.locator('button[aria-label="最小化視窗"]')).toBeVisible();
  await expect(page.locator('button[aria-label="關閉視窗"]')).toBeVisible();
  await page.screenshot({ path: shot('ui-titlebar.png') });

  // 檢視 選單可開、含版面動作
  await page.locator('.pd-titlebar-menubtn', { hasText: '檢視' }).click();
  await expect(page.locator('.pd-titlebar-item', { hasText: '重設版面' })).toBeVisible();
  await page.screenshot({ path: shot('ui-viewmenu.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.pd-titlebar-item', { hasText: '重設版面' })).toHaveCount(0);

  // ── #3 編輯器顯隱切換鈕（真實 dockview 行為）──
  const editorBtn = page.locator('button[aria-label="切換編輯器顯示"]');
  await expect(editorBtn).toBeVisible();
  await expect(editorBtn).toHaveAttribute('aria-pressed', 'true'); // 預設顯示
  await editorBtn.click();
  await expect(editorBtn).toHaveAttribute('aria-pressed', 'false'); // 隱藏
  await editorBtn.click();
  await expect(editorBtn).toHaveAttribute('aria-pressed', 'true'); // 還原

  // ── #1 git commit 線圖（真 repo 歷史）──
  await stubFolderPicker(app, [process.cwd()]); // C:\polydesk-dev＝本專案真 git repo
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="原始碼控制"]').click(); // 切 SCM 視圖
  await page.locator('button[role="tab"]', { hasText: '歷史' }).click();
  await expect(page.locator('.pd-scm-graph').first()).toBeVisible({ timeout: 15000 }); // 線圖 SVG 真的畫出
  await page.screenshot({ path: shot('ui-gitgraph.png') });

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
