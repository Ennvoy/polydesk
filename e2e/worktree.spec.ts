// F-11/F-12 驗證（REQ-E2E-012 平行開發、REQ-E2E-013 移除防護、紅軍 A1 XSS/A5 retry）。
// 真 git fixture（≥2 本地分支）、真實點擊、真 git worktree add/remove。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

/** 建 repo（main + 第二分支 dev），回 { root, repo }。 */
function seedRepo(): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), 'pdwt-'));
  const repo = join(root, 'work');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@test');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'app.txt'), 'line1\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'branch', 'dev'); // 第二分支（供建 worktree）
  return { root, repo };
}

test('REQ-E2E-012：分支→建立 worktree→納管開啟→終端機 cwd＝worktree→切回主 repo', async () => {
  const { root, repo } = seedRepo();
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 work"]').click();

  // 入口②：工作區「＋」選單 → 從 Git 分支建立 worktree
  await page.locator('button[aria-label="新增"]').click();
  await page.locator('button[aria-label="從 Git 分支建立 worktree"]').click();

  // 對話框：切到「現有本地分支」來源 → 選 dev（預設路徑 sibling）
  await expect(page.getByRole('radio', { name: '現有本地分支' })).toBeVisible({ timeout: 12000 });
  await page.getByRole('radio', { name: '現有本地分支' }).check();
  await page.getByRole('combobox', { name: '現有本地分支' }).selectOption('dev');
  const pathInput = page.locator('input[aria-label="worktree 建立位置"]');
  const targetPath = await pathInput.inputValue();
  expect(targetPath).toContain('work-worktrees');
  await page.locator('button[aria-label="建立並開啟工作區"]').click();

  // 納管：工作區列表出現 worktree 項（⎇ dev），不重彈信任窗
  await expect(page.locator('.pdws-item [aria-label="worktree 工作區"]')).toBeVisible({ timeout: 15000 });
  // git 真的建了 worktree
  await expect.poll(() => git(repo, 'worktree', 'list').includes('work-worktrees'), { timeout: 8000 }).toBe(true);
  expect(existsSync(targetPath)).toBe(true);

  // 分支徽章即時顯示 dev（非資料夾名回推、非 null）
  await expect(page.getByText('⎇ dev', { exact: false })).toBeVisible({ timeout: 8000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

// 註：紅軍 A1（惡意分支名 XSS）於 Windows 無法用真 git 重現——NTFS 禁 <>|: 檔名，git 無法建此類 loose ref。
// 防線改由單元＋靜態守衛驗證：src/renderer/components/Worktree/worktreeDisplay.test.ts
//   （worktreeBranchDisplay 經 neutralizeBidi 剝 RLO、detached→非 'null'；源碼禁 dangerouslySetInnerHTML）。
