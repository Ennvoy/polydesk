// X-3 a11y：REQ-E2E-011 純鍵盤主路徑（新增工作區→開檔→存檔），不使用滑鼠。
// 以「Tab 到目標 aria-label 再 Enter」驗證焦點順序與 aria 皆正確（能用鍵盤抵達每個控制＝焦點鏈通）。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker } from './electronApp';

/** 連按 Tab 直到目前焦點元素的 aria-label === label（純鍵盤導航）。 */
async function tabTo(page: Page, label: string, max = 60): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    const cur = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
    if (cur === label) return true;
    await page.keyboard.press('Tab');
    await page.waitForTimeout(15);
  }
  const cur = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
  return cur === label;
}

test('REQ-E2E-011：純鍵盤 新增工作區 → 開檔 → 存檔', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pdkbd-'));
  const dir = join(root, 'kbd-ws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'note.txt'), 'orig\n');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await expect(page.getByText('還沒有工作區')).toBeVisible({ timeout: 15000 });

  // 1) 新增工作區（鍵盤）
  expect(await tabTo(page, '新增工作區'), '焦點抵達「新增工作區」').toBe(true);
  await page.keyboard.press('Enter');

  // 2) 信任確認彈窗（鍵盤）— 等彈窗出現再導航
  await expect(page.locator('button[aria-label="信任並新增工作區"]')).toBeVisible({ timeout: 10000 });
  expect(await tabTo(page, '信任並新增工作區'), '焦點抵達「信任並新增工作區」').toBe(true);
  await page.keyboard.press('Enter');

  // 3) 工作區載入 → 檔案樹出現 note.txt（treeitem）
  const fileItem = page.locator('[role="treeitem"][aria-label="note.txt"]');
  await expect(fileItem).toBeVisible({ timeout: 15000 });

  // 4) 開檔（鍵盤）— Tab 到 treeitem 再 Enter（Explorer onRowKeyDown 開檔）
  expect(await tabTo(page, 'note.txt'), '焦點抵達 note.txt treeitem').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500); // 待開檔後編輯器自動聚焦

  // 5) 編輯 + 存檔（純鍵盤）
  await page.keyboard.type('KBD_SAVE ');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(900);

  // 6) 真實驗證：磁碟已寫入（純鍵盤完成 新增→開檔→編輯→存檔）
  expect(readFileSync(join(dir, 'note.txt'), 'utf8')).toContain('KBD_SAVE');

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
