// F-4 驗證（REQ-E2E-009）：開檔+未存編輯 → 外部修改 → 衝突彈窗 → 「保留我的」/「載入磁碟版」各一次。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(file: string, content: string): { dir: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'pdconf-'));
  const dir = join(root, 'conf-ws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content);
  return { dir, file: join(dir, file) };
}

async function openAndDirty(page: import('@playwright/test').Page): Promise<void> {
  await page.getByText('note.txt', { exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('LOCAL_EDIT');
}

test('REQ-E2E-009：外部修改 + 未存編輯 →「保留我的編輯」', async () => {
  const { dir, file } = seedDir('note.txt', 'original\n');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 conf-ws"]').click();
  await openAndDirty(page);

  // 外部修改磁碟（watcher 已隨 Explorer 啟動）
  writeFileSync(file, 'EXTERNAL_CHANGE\n');

  // 衝突彈窗 → 保留我的編輯
  const keep = page.locator('button[aria-label="保留我的編輯"]');
  await expect(keep).toBeVisible({ timeout: 15000 });
  await keep.click();
  await expect(keep).toHaveCount(0);
  // 保留＝不載入磁碟版：磁碟仍為外部版本（app 未覆寫）
  expect(readFileSync(file, 'utf8')).toContain('EXTERNAL_CHANGE');

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test('REQ-E2E-009：外部修改 + 未存編輯 →「載入磁碟版本」', async () => {
  const { dir, file } = seedDir('note.txt', 'original\n');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 conf-ws"]').click();
  await openAndDirty(page);

  writeFileSync(file, 'EXTERNAL_RELOAD_MARKER\n');

  const reload = page.locator('button[aria-label="載入磁碟版本"]');
  await expect(reload).toBeVisible({ timeout: 15000 });
  await reload.click();
  await expect(reload).toHaveCount(0);
  // 載入磁碟版：編輯器顯示外部內容
  await expect(page.locator('.monaco-editor').first()).toContainText('EXTERNAL_RELOAD_MARKER', { timeout: 10000 });

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
