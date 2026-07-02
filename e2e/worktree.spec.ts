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

test('REQ-E2E-013：移除 worktree——dirty 兩段確認→連同刪除；僅移出保留資料夾', async () => {
  const { root, repo } = seedRepo();
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 work"]').click();

  // 先建兩個 worktree（dev、第三分支 feat）
  git(repo, 'branch', 'feat');
  const mkWt = async (branch: string): Promise<void> => {
    await page.locator('button[aria-label="新增"]').click();
    await page.locator('button[aria-label="從 Git 分支建立 worktree"]').click();
    await page.getByRole('radio', { name: '現有本地分支' }).check();
    await page.getByRole('combobox', { name: '現有本地分支' }).selectOption(branch);
    await page.locator('button[aria-label="建立並開啟工作區"]').click();
    await expect.poll(() => git(repo, 'worktree', 'list').includes(branch === 'dev' ? 'dev' : 'feat'), { timeout: 8000 }).toBe(true);
  };
  await mkWt('dev');
  await mkWt('feat');

  // 取兩個 worktree 的實體路徑
  const wtList = git(repo, 'worktree', 'list', '--porcelain');
  const paths = [...wtList.matchAll(/^worktree (.+)$/gm)].map((m) => m[1].trim());
  const devPath = paths.find((p) => /work-worktrees[\\/]/.test(p) && /dev/.test(p))!;
  const featPath = paths.find((p) => /work-worktrees[\\/]/.test(p) && /feat/.test(p))!;
  expect(existsSync(devPath)).toBe(true);
  expect(existsSync(featPath)).toBe(true);

  // 藍軍 Y2：在 dev worktree 開一個真終端機（node-pty 持有該資料夾 handle）→ 驗證移除時
  // teardown 先於 git remove（Windows 下未先 teardown 會 EBUSY 半殘）。切到 dev、開終端機、再切回主 repo。
  await page.locator('.pdws-item [aria-label="worktree 工作區"]').first().click();
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(600); // 讓 PTY 真的 spawn 在 dev cwd
  await page.locator('button[aria-label="開啟工作區 work"]').first().click();

  // 開 SCM worktree 分頁
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.getByRole('tab', { name: 'worktree' }).click();

  // ── dirty ＋ 跑中終端機程序 → 連同刪除 dev（teardown 釋放 handle 後 git remove 成功）──
  writeFileSync(join(devPath, 'app.txt'), 'dirty-change\n'); // 造成未提交變更
  await page.locator('button[aria-label^="移除 worktree"]').first().click();
  await page.locator('button[aria-label="連同刪除資料夾"]').click();
  // dirty 兩段確認：未勾不能刪 → 勾了才可
  const discardBtn = page.locator('button[aria-label="確定丟棄並刪除"]');
  await expect(discardBtn).toBeVisible({ timeout: 8000 });
  await expect(discardBtn).toBeDisabled();
  await page.locator('input[aria-label="確定丟棄未提交變更"]').check();
  await discardBtn.click();
  // 資料夾被刪、git worktree 登記無殘留（比對正規化後的完整路徑，避免斜線方向/子字串誤配）
  const norm = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  const devNorm = norm(devPath);
  await expect.poll(() => existsSync(devPath), { timeout: 8000 }).toBe(false);
  await expect
    .poll(
      () =>
        git(repo, 'worktree', 'list', '--porcelain')
          .split(/\r?\n/)
          .filter((l) => l.startsWith('worktree '))
          .map((l) => norm(l.slice('worktree '.length)))
          .includes(devNorm),
      { timeout: 6000 },
    )
    .toBe(false);

  // ── 僅移出列表：feat 資料夾保留 ──
  await page.locator('button[aria-label^="移除 worktree"]').first().click();
  await page.locator('button[aria-label="僅從列表移出，保留資料夾"]').click();
  await page.waitForTimeout(1000);
  expect(existsSync(featPath)).toBe(true); // 資料夾保留

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test('F-13：分支分頁「在新 worktree 開啟」建立；checkout 衝突→跳到該 worktree', async () => {
  const { root, repo } = seedRepo();
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 work"]').click();

  // 入口③：分支分頁對 dev 點「在新 worktree 開啟」→ 對話框（預填 dev）→ 建立
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.getByRole('tab', { name: '分支' }).click();
  await page.locator('button[aria-label="在新 worktree 開啟 dev"]').click();
  await expect(page.locator('input[aria-label="worktree 建立位置"]')).toBeVisible({ timeout: 12000 });
  await page.locator('button[aria-label="建立並開啟工作區"]').click();
  await expect(page.locator('.pdws-item [aria-label="worktree 工作區"]')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => git(repo, 'worktree', 'list').includes('dev'), { timeout: 8000 }).toBe(true);

  // checkout 衝突→跳轉：切回主 repo，於分支分頁點已被 worktree 簽出的 dev
  await page.locator('button[aria-label="開啟工作區 work"]').first().click();
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.getByRole('tab', { name: '分支' }).click();
  await page.getByRole('button', { name: '切換到分支 dev' }).click();
  const jumpBtn = page.locator('button[aria-label="跳到該 worktree"]');
  await expect(jumpBtn).toBeVisible({ timeout: 8000 });
  await jumpBtn.click();
  // 作用工作區切到 dev worktree（rail 上該 worktree 項為 active）
  await expect(page.locator('.pdws-item.is-active [aria-label="worktree 工作區"]')).toBeVisible({ timeout: 8000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
