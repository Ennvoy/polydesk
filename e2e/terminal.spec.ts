// F-3 驗證（REQ-E2E-008）：工作區有跑中終端機 → 移除工作區 → 關閉確認彈窗 → 確認後移除。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pdterm-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('REQ-E2E-008：跑中終端機 → 移除工作區彈關閉確認 → 確認後移除', async () => {
  const dir = seedDir('term-ws');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 term-ws"]').click();

  // 開一個終端機（real PTY，alive）
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first()).toBeVisible({ timeout: 15000 });

  // 移除工作區 → RemoveWorkspaceDialog 確認
  await page.locator('button[aria-label="移除 term-ws"]').click();
  await page.locator('button[aria-label="移除工作區"]').click();

  // 因有 alive 終端機 → CloseConfirm 彈窗（仍要關閉）
  const closeBtn = page.locator('button[aria-label="仍要關閉"], button:has-text("仍要關閉")').first();
  await expect(closeBtn).toBeVisible({ timeout: 10000 });
  await closeBtn.click();

  // 工作區已移除（列表回空狀態）
  await expect(page.locator('button[aria-label="開啟工作區 term-ws"]')).toHaveCount(0, { timeout: 10000 });

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
