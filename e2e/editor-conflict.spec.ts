// F-4 驗證（REQ-E2E-009）：外部修改 + 未存編輯 → 不再彈窗打斷，改成「只標記、關檔時才提醒儲存」。
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

const noteTab = (page: import('@playwright/test').Page) => page.locator('[role="tab"][aria-label*="note.txt"]');

test('REQ-E2E-009：外部修改不再彈窗打斷；關檔時才提醒（不儲存）', async () => {
  const { dir, file } = seedDir('note.txt', 'original\n');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 conf-ws"]').click();
  await openAndDirty(page);

  // 外部修改磁碟（watcher 隨 Explorer 啟動）
  writeFileSync(file, 'EXTERNAL_CHANGE\n');
  await page.waitForTimeout(1200); // 讓 fs:change 到達並標記 diskChanged

  // 不再彈衝突窗打斷
  await expect(page.locator('button[aria-label="載入磁碟版本"]')).toHaveCount(0);
  await expect(page.locator('button[aria-label="保留我的編輯"]')).toHaveCount(0);

  // 關閉分頁（focus + Delete）→ 才提醒，且附「磁碟版本不同」
  await noteTab(page).click();
  await noteTab(page).press('Delete');
  await expect(page.getByText('磁碟版本與你的編輯不同')).toBeVisible({ timeout: 5000 });
  await page.locator('button[aria-label="不儲存並關閉"]').click();
  // 不儲存＝磁碟保留外部版本（未被覆寫）
  expect(readFileSync(file, 'utf8')).toContain('EXTERNAL_CHANGE');

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test('REQ-E2E-009：關檔時選儲存 → 磁碟已被外部改 → 覆蓋存回我的編輯', async () => {
  const { dir, file } = seedDir('note.txt', 'original\n');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 conf-ws"]').click();
  await openAndDirty(page);

  writeFileSync(file, 'EXTERNAL_CHANGE\n');
  await page.waitForTimeout(1200);

  await noteTab(page).click();
  await noteTab(page).press('Delete');
  await page.locator('button[aria-label="儲存並關閉"]').click();
  // 儲存時磁碟已被外部改 → 衝突彈窗 → 選「保留我的編輯」＝覆蓋
  const overwrite = page.locator('button[aria-label="保留我的編輯"]');
  await expect(overwrite).toBeVisible({ timeout: 5000 });
  await overwrite.click();
  // 覆蓋：磁碟寫入我的編輯（含 LOCAL_EDIT）
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('LOCAL_EDIT');

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
