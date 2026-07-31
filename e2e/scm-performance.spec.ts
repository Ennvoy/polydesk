// SCM 卡頓回歸：大量變更不一次建立所有 React 節點；檔案事件風暴只做一輪共用 snapshot；
// 停在歷史頁時，純 worktree 變動不應反覆重跑 git log。
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

async function perfCount(page: Page, name: string): Promise<number> {
  return page.evaluate((measureName) => {
    const perf = (window as unknown as { __pdPerf?: { getMeasures: (name: string) => number[] } }).__pdPerf;
    return perf?.getMeasures(measureName).length ?? 0;
  }, name);
}

test('大量變更分批渲染，檔案事件不重複掃 Git 或重載歷史', async () => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'pd-scm-perf-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'perf@test.local');
  git(repo, 'config', 'user.name', 'SCM Perf');
  writeFileSync(join(repo, 'tracked.txt'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'initial');
  for (let index = 0; index < 600; index++) {
    writeFileSync(join(repo, `change-${String(index).padStart(4, '0')}.txt`), `change ${index}\n`);
  }

  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 repo"]').click();
    await page.locator('button[aria-label="原始碼控制"]').click();

    await expect(page.locator('.pd-scm-grouplabel', { hasText: '變更 (600)' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.pd-scm-change')).toHaveCount(200);
    await expect(page.getByRole('button', { name: '顯示更多 變更，尚有 400 項' })).toBeVisible();

    await page.getByRole('tab', { name: '歷史' }).click();
    await expect(page.locator('.pd-scm-logrow').first()).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      (window as unknown as { __pdPerf?: { clearPerf: () => void } }).__pdPerf?.clearPerf();
    });

    // 四波真實檔案變動：snapshot 可每波更新一次，但 history 不應因 changes 陣列換參考而重載。
    for (let index = 0; index < 4; index++) {
      writeFileSync(join(repo, 'tracked.txt'), `wave ${index}\n`);
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(1_500);

    const snapshotRequests = await perfCount(page, 'gitSnapshotRequest');
    const extraGitLogRequests = await perfCount(page, 'gitLogRequest');
    const report = {
      changes: 600,
      initialRenderedRows: 200,
      eventWaves: 4,
      snapshotRequests,
      snapshotRequestBudget: 5,
      extraGitLogRequests,
    };
    const reportDir = process.env.PD_SHOT_DIR || join(process.cwd(), 'test-results');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'scm-performance-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\n=== SCM PERFORMANCE ===\n${JSON.stringify(report, null, 2)}`);

    expect(snapshotRequests, '四波事件的 Git snapshot 次數').toBeLessThanOrEqual(5);
    expect(extraGitLogRequests, '純 worktree 變動不重跑 git log').toBe(0);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
