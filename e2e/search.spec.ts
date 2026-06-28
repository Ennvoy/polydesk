// F-6 驗證（REQ-E2E-006）：搜尋→串流結果（排除 node_modules）→點命中跳檔。真 ripgrep + 真 fs。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'pdsearch-'));
  const dir = join(root, 'searchws');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.txt'), 'hello FINDME_TOKEN world\n');
  writeFileSync(join(dir, 'node_modules', 'dep', 'd.txt'), 'FINDME_TOKEN in deps\n');
  return dir;
}

test('REQ-E2E-006：全域搜尋串流結果（排除 node_modules）→點命中跳檔', async () => {
  const dir = seedRepo();
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 searchws"]').click();

  // 切到搜尋視圖 → 輸入
  await page.locator('button[aria-label="搜尋"]').click();
  await page.locator('input[aria-label="搜尋字詞"]').fill('FINDME_TOKEN');

  // 結果出現：src/a.txt 命中，且不含 node_modules
  const hit = page.locator('[aria-label*="a.txt 第 1 行"]').first();
  await expect(hit).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[role="region"][aria-label="搜尋結果"]')).not.toContainText('node_modules');

  // 點命中 → 編輯器開啟該檔
  await hit.click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.monaco-editor').first()).toContainText('FINDME_TOKEN', { timeout: 10000 });

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
