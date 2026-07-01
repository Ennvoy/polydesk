// 總覽面板：toolbar「總覽」toggle → 最大化 overlay，顯示 claude/codex 用量卡片 + 各工作區 AI 狀態 → 關閉。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('總覽面板：開 → 用量卡片 + 工作區狀態 → 關閉', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  // 點總覽 → overlay 出現
  await page.locator('button[aria-label="開啟總覽"]').click();
  const overview = page.locator('[role="dialog"][aria-label="總覽"]');
  await expect(overview).toBeVisible();

  // 用量區（Claude/Codex 卡片）+ 工作區狀態區
  await expect(overview.getByText('服務用量', { exact: false })).toBeVisible();
  await expect(overview.getByRole('heading', { name: 'Claude' })).toBeVisible();
  await expect(overview.getByRole('heading', { name: 'Codex' })).toBeVisible();
  await expect(overview.getByText('工作區 AI 狀態')).toBeVisible();
  await expect(overview.getByText('proj', { exact: true })).toBeVisible();

  // 關閉
  await page.locator('button[aria-label="關閉總覽"]').click();
  await expect(overview).toHaveCount(0);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
