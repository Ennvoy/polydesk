// PE-1：git 線圖 commit hover 完整訊息 + 右鍵選單（複製/開啟此 commit 變更/簽出/從此 commit 建分支）。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' });

test('commit hover 卡片 + 右鍵選單（開啟此 commit 變更 / 從此 commit 建分支）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-ca-'));
  const dir = join(root, 'ca-ws');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.test');
  git(dir, 'config', 'user.name', 'Tester');
  writeFileSync(join(dir, 'f.txt'), 'v1\n');
  git(dir, 'add', '-A');
  // subject + body（hover 卡片顯示完整訊息）
  git(dir, 'commit', '-m', 'feat: 主題行', '-m', 'BODY_DETAIL_LINE 內文細節');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 ca-ws"]').click();
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.locator('button[role="tab"]', { hasText: '歷史' }).click();

  const row = page.locator('.pd-scm-logrow').first();
  await expect(row).toBeVisible({ timeout: 15000 });

  // hover → 卡片含完整訊息 body
  await row.hover();
  await expect(page.locator('.pd-scm-hovercard')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.pd-scm-hovercard')).toContainText('BODY_DETAIL_LINE');

  // 右鍵 → 選單出現
  await row.click({ button: 'right' });
  const menu = page.locator('.pd-scm-ctxmenu');
  await expect(menu).toBeVisible({ timeout: 8000 });
  await expect(menu.locator('.pd-scm-ctxitem', { hasText: '開啟此 commit 變更' })).toBeVisible();

  // 「開啟此 commit 變更」→ 編輯器區 commit diff 分頁
  await menu.locator('.pd-scm-ctxitem', { hasText: '開啟此 commit 變更' }).click();
  await expect(page.locator('[role="tab"]').filter({ hasText: 'commit' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pd-editor-diffpane .monaco-diff-editor').first()).toBeVisible({ timeout: 15000 });

  // 右鍵 →「從此 commit 建立分支」→ 輸入名→建立並切換
  await row.click({ button: 'right' });
  await page.locator('.pd-scm-ctxitem', { hasText: '從此 commit 建立分支' }).click();
  await page.locator('input[aria-label="新分支名稱"]').fill('from-commit');
  await page.locator('button[aria-label="建立分支"]').click();
  // 切到分支分頁、新分支為 active
  await expect(page.locator('.pd-scm-branchrow.is-active', { hasText: 'from-commit' })).toBeVisible({ timeout: 12000 });
  expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('from-commit');

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
