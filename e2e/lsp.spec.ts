// F-5 驗證（REQ-E2E-002 後半、REQ-EDIT-005）：開未裝語言伺服器的檔 → 不擋路缺件提示 +
// 仍可編輯/存檔（語法高亮由 monaco 提供）。本機已確認無任何 LSP server → 降級路徑決定性。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedRepo(): { dir: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'pdlsp-'));
  const dir = join(root, 'lspws');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'main.py');
  writeFileSync(file, 'x = 1\n');
  return { dir, file };
}

test('REQ-E2E-002 後半：開 .py（無 LSP）→ 缺件提示 + 仍可編輯存檔', async () => {
  const { dir, file } = seedRepo();
  // 最小 PATH：構造性保證找不到 pyright-langserver（機器裝了 LSP 也不影響降級路徑的決定性）
  const { app, page, userData } = await launchApp({
    env: { PATH: 'C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0' },
  });
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 lspws"]').click();

  // 開 main.py
  await page.getByText('main.py', { exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });

  // 不擋路缺件提示（toast）：未偵測到 Python 語言伺服器
  await expect(page.locator('[aria-label="語言伺服器提示"]')).toContainText('Python', { timeout: 15000 });

  // 仍可編輯/存檔（降級不阻擋）
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\ny = 2  # EDIT_OK');
  await page.keyboard.press('Control+S');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 10000 }).toContain('EDIT_OK');

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
