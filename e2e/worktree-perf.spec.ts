// X-5 worktree 效能 budget（REQ-PERF-005/006）。以程式 timestamp 埋點（perf.ts，非肉眼）真實量測：
// - worktreeListLoad：SCM worktree 分頁 list→渲染 p95 < 300ms（本地操作）
// - worktreeCreate：建立 worktree（本地分支）p95 < 5s；全程 UI 不凍結（非同步＋進行中指示，獨立謂詞）
// 經真 electron + 真 git，由 renderer window.__pdPerf 讀回。務實 N（嚴謹 30 次 + 基準機留 ship 慣例，對齊 perf.spec）。
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const N_LIST = 10;
const N_CREATE = 6;
const BUDGET = { worktreeListLoad: 300, worktreeCreate: 5000 };

const reportDir = process.env.PD_SHOT_DIR || join(process.cwd(), 'test-results');

function p95(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * 0.95) - 1))];
}
const rendererMeasures = (page: Page, name: string): Promise<number[]> =>
  page.evaluate((n) => {
    const g = (window as unknown as { __pdPerf?: { getMeasures(x: string): number[] } }).__pdPerf;
    return g ? g.getMeasures(n) : [];
  }, name);

function seedRepo(branches: string[]): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), 'pdwtperf-'));
  const repo = join(root, 'work');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@test');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'app.txt'), 'line1\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  for (const b of branches) git(repo, 'branch', b);
  return { root, repo };
}

test('REQ-PERF-005/006：worktree 分頁載入 p95<300ms、建立 p95<5s（UI 不凍結）', async () => {
  test.setTimeout(240_000);
  const branches = Array.from({ length: N_CREATE }, (_, i) => `feat-${i}`);
  const { root, repo } = seedRepo(branches);
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [repo]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 work"]').click();
  await page.locator('button[aria-label="原始碼控制"]').click();

  // ── worktreeListLoad：反覆進出 worktree 分頁量 list 載入 ──
  for (let i = 0; i < N_LIST; i++) {
    await page.getByRole('tab', { name: 'worktree' }).click();
    await expect(page.locator('.pd-scm-body')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(120);
    await page.getByRole('tab', { name: '變更' }).click();
    await page.waitForTimeout(80);
  }
  const listSamples = await rendererMeasures(page, 'worktreeListLoad');

  // ── worktreeCreate：對每個分支建立 worktree（本地來源，不含 remote）──
  for (const b of branches) {
    await page.getByRole('tab', { name: 'worktree' }).click();
    await page.locator('button[aria-label="建立 worktree"]').click();
    await page.getByRole('radio', { name: '現有本地分支' }).check();
    await page.getByRole('combobox', { name: '現有本地分支' }).selectOption(b);
    await page.locator('button[aria-label="建立並開啟工作區"]').click();
    await expect.poll(() => git(repo, 'worktree', 'list').includes(b), { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(150);
  }
  const createSamples = await rendererMeasures(page, 'worktreeCreate');

  const report = {
    machine: { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, totalMemGB: Math.round(totalmem() / 1e9) },
    note: '務實 N 量測（嚴謹 30 次 p95 + 基準機規格留 ship 量一次）',
    budgets: BUDGET,
    worktreeListLoad: { p95: Math.round(p95(listSamples)), n: listSamples.length, budget: BUDGET.worktreeListLoad },
    worktreeCreate: { p95: Math.round(p95(createSamples)), n: createSamples.length, budget: BUDGET.worktreeCreate },
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'worktree-perf-report.json'), JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log('\n=== WORKTREE PERF ===\n' + JSON.stringify(report, null, 2));

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });

  // 樣本數下限（防 under-sampling 假綠）＋ budget
  expect(listSamples.length, 'listLoad 樣本').toBeGreaterThanOrEqual(N_LIST);
  expect(p95(listSamples), 'listLoad p95').toBeLessThan(BUDGET.worktreeListLoad);
  expect(createSamples.length, 'create 樣本').toBeGreaterThanOrEqual(N_CREATE);
  expect(p95(createSamples), 'create p95').toBeLessThan(BUDGET.worktreeCreate);
});
