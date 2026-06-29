// Dogfood：點 SCM 變更檔 → 在編輯器區開差異分頁（工作樹 vs HEAD，like VSCode）。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' });

test('點變更檔 → 編輯器區開 diff 分頁（含 Monaco diff）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-diff-'));
  const dir = join(root, 'diff-ws');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.test');
  git(dir, 'config', 'user.name', 'Tester');
  writeFileSync(join(dir, 'hello.txt'), 'line1\nline2\nline3\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  writeFileSync(join(dir, 'hello.txt'), 'line1\nCHANGED\nline3\n'); // 製造工作樹變更

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 diff-ws"]').click();
  await page.locator('button[aria-label="原始碼控制"]').click(); // 切 SCM（變更分頁預設）

  // 點變更清單中的 hello.txt
  const changeItem = page.locator('button[aria-label="檢視差異：hello.txt"]');
  await expect(changeItem).toBeVisible({ timeout: 15000 });
  await changeItem.click();

  // 編輯器區出現 diff 分頁（名稱含「差異」）+ Monaco diff editor
  await expect(page.locator('[role="tab"]').filter({ hasText: '（差異）' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pd-editor-diffpane .monaco-diff-editor').first()).toBeVisible({ timeout: 15000 });
  // diff 內容含改動行
  await expect(page.locator('.pd-editor-diffpane')).toContainText('CHANGED', { timeout: 10000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
