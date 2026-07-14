// Activity Bar 原始碼控制徽章：顯示目前工作區的未提交檔案數，切換工作區後不可殘留前一個數字。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI, makeTempDir } from './electronApp';

function seedRepo(root: string, name: string, dirtyFiles: number): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'badge@test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Badge Test'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'tracked.txt'), 'committed\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  for (let i = 1; i <= dirtyFiles; i += 1) writeFileSync(join(dir, `dirty-${i}.txt`), `dirty ${i}\n`);
  return dir;
}

test('切換工作區時 SCM 圖示顯示目前工作區的未提交檔案數', async () => {
  const root = makeTempDir('pd-scm-badge-');
  const dirty = seedRepo(root, 'dirty-workspace', 2);
  const clean = seedRepo(root, 'clean-workspace', 0);
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dirty, clean]);
    await addWorkspaceViaUI(page);

    const scmButton = page.locator('button[aria-label="原始碼控制"]');
    const badge = scmButton.locator('[data-testid="scm-change-count"]');
    await expect(badge).toHaveText('2', { timeout: 12000 });
    await expect(scmButton).toHaveAttribute('title', '原始碼控制（2 個未提交變更）');

    await page.locator('button[aria-label="新增"]').click();
    await page.locator('button[aria-label="新增工作區"]').click();
    await page.locator('button[aria-label="信任並新增工作區"]').click();
    await expect(badge).toHaveCount(0, { timeout: 12000 });

    await page.locator('button[aria-label="開啟工作區 dirty-workspace"]').click();
    await expect(badge).toHaveText('2', { timeout: 12000 });
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
