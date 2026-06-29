// 驗證手動 Stash 含 untracked（-u）：點 Stash 收起未追蹤新檔、Stash Pop 取回（修「點了沒反應」）。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' });

test('手動 Stash 含 untracked：收起新檔 + Stash Pop 取回', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-stash-'));
  const dir = join(root, 'stash-ws');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.test');
  git(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'base.txt'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  writeFileSync(join(dir, 'untracked.txt'), 'NEW\n'); // 未追蹤新檔

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 stash-ws"]').click();
  await page.locator('button[aria-label="原始碼控制"]').click();

  const item = page.locator('button[aria-label="檢視差異：untracked.txt"]');
  await expect(item).toBeVisible({ timeout: 15000 });

  // Stash（含 -u）→ 新檔從工作樹 + 變更清單消失。
  await page.locator('button[aria-label="暫存變更（stash）"]').click();
  await expect.poll(() => existsSync(join(dir, 'untracked.txt')), { timeout: 10000 }).toBe(false);
  await expect(item).toBeHidden({ timeout: 10000 });

  // Stash Pop → 取回。
  await page.locator('button[aria-label="還原暫存（stash pop）"]').click();
  await expect.poll(() => existsSync(join(dir, 'untracked.txt')), { timeout: 10000 }).toBe(true);
  await expect(item).toBeVisible({ timeout: 10000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
