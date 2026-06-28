// Wave 2 驗證（F-1 / F-2 / F-4）：工作區新增/切換（REQ-E2E-001）、F-1-A1 XSS 渲染、
// 編輯器開檔/輸入/存檔（REQ-E2E-002 前半）。真 Electron + 真 fs + 真 IPC，不 mock app 邏輯。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string, files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'pdws-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  return dir;
}

test('REQ-E2E-001：歡迎頁→新增 A→新增 B→切 A→切 B（真實點擊）', async () => {
  const dirA = seedDir('proj-A', { 'readme.txt': 'A' });
  const dirB = seedDir('proj-B', { 'readme.txt': 'B' });
  const { app, page, userData } = await launchApp();
  await expect(page.locator('.pd-shell')).toBeVisible();
  // 空狀態歡迎頁（REQ-WS-007）
  await expect(page.getByLabel('尚無工作區')).toBeVisible();

  await stubFolderPicker(app, [dirA, dirB]);
  await addWorkspaceViaUI(page); // 新增 A
  await expect(page.locator('button[aria-label="開啟工作區 proj-A"]')).toBeVisible();
  await addWorkspaceViaUI(page); // 新增 B
  await expect(page.locator('button[aria-label="開啟工作區 proj-B"]')).toBeVisible();

  // 切 A → 狀態列反映 A
  await page.locator('button[aria-label="開啟工作區 proj-A"]').click();
  await expect(page.locator('.pd-statusbar')).toContainText('proj-A');
  // 切 B → 狀態列反映 B
  await page.locator('button[aria-label="開啟工作區 proj-B"]').click();
  await expect(page.locator('.pd-statusbar')).toContainText('proj-B');

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});

test('F-1-A1：惡意名稱（含 <img onerror>）改名後不產生 DOM 節點（無 XSS）', async () => {
  const dirA = seedDir('proj-safe');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dirA]);
  await addWorkspaceViaUI(page);
  await expect(page.locator('button[aria-label="開啟工作區 proj-safe"]')).toBeVisible();

  // 直接經真實 IPC 改名為惡意字串（模擬惡意資料夾名落入 name），再驗渲染
  const evil = '<img src=x onerror="window.__pwned=1">';
  await page.evaluate(async (name) => {
    const ws = await window.polydesk.workspace.list();
    await window.polydesk.workspace.rename({ wsId: ws[0].id, name });
  }, evil);
  // 觸發 rail 重載
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(500);

  // 名稱以純文字渲染：rail 內不得出現 <img>，且 onerror 未執行
  const imgCount = await page.locator('.pd-rail img').count();
  expect(imgCount).toBe(0);
  const pwned = await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned);
  expect(pwned).toBeUndefined();

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});

test('REQ-E2E-002（前半）：開 TS 檔→輸入→Ctrl+S 存檔，磁碟更新', async () => {
  const dir = seedDir('proj-edit', { 'hello.ts': 'export const x = 1;\n' });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 proj-edit"]').click();

  // Explorer 顯示檔案 → 點開
  const fileNode = page.getByText('hello.ts', { exact: true });
  await expect(fileNode).toBeVisible();
  await fileNode.click();

  // Monaco 編輯器掛載
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
  // 聚焦編輯區、移到結尾、輸入
  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// EDITED_BY_E2E\n');
  // 存檔
  await page.keyboard.press('Control+S');

  // 磁碟內容更新（真實寫回）
  await expect.poll(() => readFileSync(join(dir, 'hello.ts'), 'utf8'), { timeout: 10000 }).toContain('EDITED_BY_E2E');

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
