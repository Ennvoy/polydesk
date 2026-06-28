// F-7 驗證（REQ-E2E-003）：編輯造成變更→SCM 出現→stage→commit→變更清空、未推送 ahead+1。
// 真 git + 真 fixture（含 upstream、≥2 分支），真實點擊。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** 建一個含 upstream（origin/main）與第二分支 dev 的真 git repo，回傳 work tree 路徑。 */
function seedGitRepo(): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), 'pdgit-'));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'work');
  mkdirSync(remote, { recursive: true });
  mkdirSync(repo, { recursive: true });
  git(remote, 'init', '--bare', '-b', 'main');
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@test');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'app.txt'), 'line1\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  git(repo, 'branch', 'dev'); // 第二分支
  return { root, repo };
}

test('REQ-E2E-003：編輯→變更出現→stage→commit→清空、ahead+1', async () => {
  const { root, repo } = seedGitRepo();
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 work"]').click();

  // 在磁碟造成變更
  appendFileSync(join(repo, 'app.txt'), 'line2\n');

  // 切到原始碼控制視圖
  await page.locator('button[aria-label="原始碼控制"]').click();
  // 變更出現（app.txt 的暫存按鈕）
  const stageBtn = page.locator('button[aria-label^="暫存："]').first();
  await expect(stageBtn).toBeVisible({ timeout: 12000 });

  // stage → commit
  await stageBtn.click();
  await page.locator('textarea[aria-label="commit 訊息"], input[aria-label="commit 訊息"]').fill('e2e: line2');
  await page.locator('button[aria-label="提交（commit）"]').click();

  // 變更清空（無暫存/未暫存按鈕）+ ahead 顯示 1
  await expect(page.locator('button[aria-label^="暫存："]')).toHaveCount(0, { timeout: 12000 });
  await expect(page.locator('[aria-label*="領先 1"]')).toBeVisible({ timeout: 12000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
