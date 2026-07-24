// Windows PATH 相容性回歸：node-pty 1.1.0 會漏掃沒有尾分號的最後一段。
// 模擬 Sunlike365 安裝後把 System32 排到 PATH 最後，驗證 Polydesk 仍以絕對路徑建立 PowerShell。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 as pathWin32 } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('System32 位於 PATH 最後且沒有尾分號時仍可建立 PowerShell', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-path-regression-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });

  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  const affectedPath = `C:\\Sunlike365;${pathWin32.join(systemRoot, 'System32')}`;
  const { app, page, userData } = await launchApp({ env: { PATH: affectedPath } });

  try {
    await stubFolderPicker(app, [workspace]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 workspace"]').click();

    await page.locator('button[aria-label="新增終端機"]').click();

    await expect(page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.pd-term-create-error')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test('shell 不存在時顯示結構化錯誤，不再像按鈕沒有反應', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-shell-error-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });

  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  const { app, page, userData } = await launchApp({
    env: {
      PATH: pathWin32.join(systemRoot, 'System32'),
      ProgramFiles: 'C:\\Polydesk-Test-Missing-ProgramFiles',
    },
  });

  try {
    await stubFolderPicker(app, [workspace]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 workspace"]').click();

    await page.locator('select[aria-label="新終端機 shell 類型"]').selectOption('pwsh');
    await page.locator('button[aria-label="新增終端機"]').click();

    await expect(page.locator('.pd-term-create-error')).toContainText('找不到 PowerShell 7 執行檔');
    await expect(page.locator('.pd-term-create-error')).toContainText('錯誤代碼：shell-not-found');
    await expect(page.locator('.pd-term-pane')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
