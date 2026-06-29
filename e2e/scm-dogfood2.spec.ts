// Dogfood 第二批：untracked 檔 diff 整檔新增、變更檔右鍵（暫存/取消變更/加 .gitignore）、點 commit 展開檔案。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' });

function seed(name: string): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pd-d2-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.test');
  git(dir, 'config', 'user.name', 'Tester');
  writeFileSync(join(dir, 'f.txt'), 'orig\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init f');
  return { root, dir };
}

test('untracked diff 整檔新增 + 右鍵加 .gitignore + 右鍵取消變更', async () => {
  const { root, dir } = seed('chg-ws');
  writeFileSync(join(dir, 'f.txt'), 'orig\nMODIFIED\n'); // tracked 修改
  writeFileSync(join(dir, 'new.txt'), 'NEWFILE_CONTENT\n'); // untracked 新檔

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 chg-ws"]').click();
  await page.locator('button[aria-label="原始碼控制"]').click();

  // untracked 檔點開 → 編輯器 diff 顯示整檔新增內容（修 bug：git diff 對 untracked 回空）
  const newItem = page.locator('button[aria-label="檢視差異：new.txt"]');
  await expect(newItem).toBeVisible({ timeout: 15000 });
  await newItem.click();
  await expect(page.locator('.pd-editor-diffpane .monaco-diff-editor').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pd-editor-diffpane')).toContainText('NEWFILE_CONTENT', { timeout: 10000 });

  // 右鍵 new.txt → 加到 .gitignore
  await newItem.click({ button: 'right' });
  await expect(page.locator('.pd-scm-ctxmenu')).toBeVisible({ timeout: 8000 });
  await page.locator('.pd-scm-ctxitem', { hasText: '加到 .gitignore' }).click();
  await expect.poll(() => (existsSync(join(dir, '.gitignore')) ? readFileSync(join(dir, '.gitignore'), 'utf8') : ''), { timeout: 10000 }).toContain('new.txt');
  await expect(newItem).toBeHidden({ timeout: 10000 }); // 已 ignore → 從變更消失

  // 右鍵 f.txt → 取消變更（捨棄）→ 確認 → 內容還原
  const fItem = page.locator('button[aria-label="檢視差異：f.txt"]');
  await fItem.click({ button: 'right' });
  await page.locator('.pd-scm-ctxitem', { hasText: '取消變更' }).click();
  await page.locator('button[aria-label="捨棄變更"]').click();
  await expect.poll(() => readFileSync(join(dir, 'f.txt'), 'utf8'), { timeout: 10000 }).toBe('orig\n');

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test('點 commit 展開變更檔案清單 → 點檔開單檔 commit diff', async () => {
  const { root, dir } = seed('exp-ws');
  // 第二筆 commit 改 f.txt（供展開檔案 + 單檔 commit diff）
  writeFileSync(join(dir, 'f.txt'), 'orig\nLINE2_IN_COMMIT\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'feat: 改 f');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 exp-ws"]').click();
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.locator('button[role="tab"]', { hasText: '歷史' }).click();

  // 點最新 commit 列 → 展開檔案清單
  const row = page.locator('.pd-scm-logrow').first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();
  const fileBtn = page.locator('.pd-scm-commitfile', { hasText: 'f.txt' });
  await expect(fileBtn).toBeVisible({ timeout: 10000 });

  // 點該檔 → 編輯器開單檔 commit diff（tab 名 f.txt @ <hash>）
  await fileBtn.click();
  await expect(page.locator('[role="tab"]').filter({ hasText: 'f.txt @' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pd-editor-diffpane')).toContainText('LINE2_IN_COMMIT', { timeout: 10000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
