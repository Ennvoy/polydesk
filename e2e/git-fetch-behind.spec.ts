// PE-4 驗證：遠端（bare）收到另一個 clone 的真 push 後，本地 remote-tracking ref 過期（↓0 渾然不知）；
// 按 ⟳ 重新整理順便 fetch → 同步列「↓1 未拉取」＋ pull 鈕數字角標。真 git、真 bare remote、真點擊，無 mock。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function configUser(dir: string): void {
  git(dir, 'config', 'user.email', 'e2e@test');
  git(dir, 'config', 'user.name', 'E2E');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

/** 真 bare remote＋已推上 upstream 的工作 repo。 */
function seedGitRepo(): { root: string; repo: string; remote: string } {
  const root = mkdtempSync(join(tmpdir(), 'pdfetch-'));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'work');
  mkdirSync(remote, { recursive: true });
  mkdirSync(repo, { recursive: true });
  git(remote, 'init', '--bare', '-b', 'main');
  git(repo, 'init', '-b', 'main');
  configUser(repo);
  writeFileSync(join(repo, 'app.txt'), 'line1\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  return { root, repo, remote };
}

test('PE-4：遠端進新 commit → ⟳ 重新整理順便 fetch → ↓1 未拉取＋pull 鈕角標', async () => {
  const { root, repo, remote } = seedGitRepo();
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="原始碼控制"]').click();
  await expect(page.locator('[aria-label*="落後 0"]')).toBeVisible({ timeout: 12000 });

  // 另一個 clone（模擬同事／另一台機器）推真 commit 到 bare remote——本地此刻渾然不知
  const other = join(root, 'other');
  git(root, 'clone', remote, other);
  configUser(other);
  writeFileSync(join(other, 'x.txt'), 'remote side\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'remote commit');
  git(other, 'push', 'origin', 'main');

  // ⟳（含取回）→ fetch 更新 remote-tracking ref → behind 1 浮現
  await page.locator('button[aria-label="重新整理"]').click();
  await expect(page.locator('.pd-scm-behind')).toHaveText('↓1 未拉取', { timeout: 15000 });
  await expect(page.locator('button[aria-label="拉取（pull）：1 個 commit 未拉取"]')).toBeVisible();

  // 真實資料鏈路收尾：pull 後落後歸零、遠端內容真的進工作樹
  await page.locator('button[aria-label="拉取（pull）：1 個 commit 未拉取"]').click();
  await expect(page.locator('[aria-label*="落後 0"]')).toBeVisible({ timeout: 15000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
