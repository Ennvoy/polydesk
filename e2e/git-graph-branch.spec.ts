// Dogfood 回饋第二批驗證（真 git、真 IPC、真渲染）：
//  A 線圖斷線修復：分支+合併多 lane 渲染，且「每列高度 === 線圖 SVG 高度」→ 列間無縫、線不斷。
//  B 無法切換分支修復：工作區有未提交變更時 checkout 被 git 擋 → 彈窗「Stash 並切換」，變更不丟。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const shotDir = process.env.PD_SHOT_DIR || join(process.cwd(), 'test-results'); // gitignored，避免截圖污染 repo
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
function commit(cwd: string, file: string, content: string, msg: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', msg);
}
function initRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.test');
  git(dir, 'config', 'user.name', 'Tester');
  return dir;
}
async function openScmTab(page: import('@playwright/test').Page, tab: string): Promise<void> {
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.locator('button[role="tab"]', { hasText: tab }).click();
}

test('A 線圖：分支+合併多 lane，且列高=SVG高（跨列無縫、線不斷）', async () => {
  const repo = initRepo('pd-graph-');
  commit(repo, 'base.txt', 'v1\n', 'A');
  commit(repo, 'other.txt', 'x\n', 'B');
  git(repo, 'checkout', '-b', 'feature');
  commit(repo, 'feat.txt', 'f\n', 'C feature work');
  git(repo, 'checkout', 'main');
  git(repo, 'merge', 'feature', '--no-ff', '-m', 'Merge feature'); // 合併 commit → 2 parents → 多 lane

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await openScmTab(page, '歷史');

  const firstGraph = page.locator('.pd-scm-graph').first();
  await expect(firstGraph).toBeVisible({ timeout: 15000 });

  // 多 lane：合併 → maxLanes ≥ 2 → SVG width = maxLanes*14+6 ≥ 34
  expect(Number(await firstGraph.getAttribute('width'))).toBeGreaterThanOrEqual(34);

  // 線不斷的關鍵不變量：每列高度 === 該列線圖 SVG 高度（無垂直空隙才能跨列接續）
  const rows = page.locator('.pd-scm-logrow');
  const n = Math.min(5, await rows.count());
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const rowBox = await rows.nth(i).boundingBox();
    const svgBox = await rows.nth(i).locator('.pd-scm-graph').boundingBox();
    expect(Math.abs((rowBox?.height ?? 0) - (svgBox?.height ?? -99))).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: join(shotDir, 'ui-gitgraph-merge.png') });

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test('B 切換分支：未提交變更 → 彈窗 Stash 並切換、變更不丟', async () => {
  const repo = initRepo('pd-branch-');
  commit(repo, 'base.txt', 'v1\n', 'init');
  git(repo, 'checkout', '-b', 'dev');
  commit(repo, 'base.txt', 'v2-on-dev\n', 'dev change'); // dev 的 base.txt 與 main 不同
  git(repo, 'checkout', 'main');
  writeFileSync(join(repo, 'base.txt'), 'v1-DIRTY\n'); // 弄髒（與 dev 版本衝突 → checkout 被擋）

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await openScmTab(page, '分支');

  await page.locator('.pd-scm-branchrow', { hasText: 'dev' }).click();

  // 出現未提交變更彈窗 → 按「Stash 並切換」
  await expect(page.getByText('切換分支前需處理未提交變更')).toBeVisible({ timeout: 8000 });
  await page.locator('button[aria-label="Stash 變更並切換分支"]').click();

  // 切到 dev（分支列 dev 變 active）
  await expect(page.locator('.pd-scm-branchrow.is-active', { hasText: 'dev' })).toBeVisible({ timeout: 10000 });

  // 真實狀態核對：HEAD=dev，且變更被 stash（沒丟失）
  expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('dev');
  expect(git(repo, 'stash', 'list').trim().length).toBeGreaterThan(0);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test('B2 切換分支：untracked 檔擋 checkout → stash -u 並切換、檔案不丟（審查 HIGH 修復）', async () => {
  const repo = initRepo('pd-branch-u-');
  commit(repo, 'base.txt', 'v1\n', 'init');
  git(repo, 'checkout', '-b', 'dev');
  commit(repo, 'conflict.txt', 'tracked-on-dev\n', 'dev adds conflict.txt'); // dev 追蹤此檔
  git(repo, 'checkout', 'main'); // main 無此檔
  writeFileSync(join(repo, 'conflict.txt'), 'untracked-on-main\n'); // 本地 untracked → checkout dev 被擋

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await openScmTab(page, '分支');
  await page.locator('.pd-scm-branchrow', { hasText: 'dev' }).click();

  // untracked 擋 checkout 也要能觸發彈窗（不靠在地化錯誤字串，靠結構化 status）
  await expect(page.getByText('切換分支前需處理未提交變更')).toBeVisible({ timeout: 8000 });
  await page.locator('button[aria-label="Stash 變更並切換分支"]').click();

  // 切到 dev；untracked 被 stash -u 收走（沒丟），第二次 checkout 才過得去
  await expect(page.locator('.pd-scm-branchrow.is-active', { hasText: 'dev' })).toBeVisible({ timeout: 10000 });
  expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('dev');
  expect(git(repo, 'stash', 'list').trim().length).toBeGreaterThan(0);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});
