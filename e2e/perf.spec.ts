// X-1 效能 budget 量測（REQ-PERF-001~004、REQ-MON-006）。
// 以程式 timestamp 埋點（perf.ts，非肉眼）真實量測：冷啟動 / 切已載入工作區 / 開檔 / 終端機按鍵 p95，
// 與 N=10 背景閒置監控 CPU。務實 N 先量到綠（決策：嚴謹 30 次 + 基準機規格留 ship）；數據落檔 test-results/perf-report.json。
// 經真 electron 啟動 + 真互動觸發埋點，再由診斷 seam（main globalThis.__pdPerf / renderer window.__pdPerf）讀回。
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const N_COLD = 8;
const N_SWITCH = 12;
const N_FILE = 8;
const N_KEY = 20;
const N_IDLE_WS = 10;
// 量測窗須涵蓋 ≥1 個完整 poll 週期才測得到監控成本：監控自適應間隔 = base(5s)*ceil(n/4)，
// n=10 → 15s。8s 窗會落在兩輪之間的空檔 → 假綠。設 18s（>15s）確保窗內至少發生一次列舉。
const IDLE_WINDOW_MS = 18000;

const BUDGET = { coldStart: 3000, wsSwitch: 200, fileOpen: 500, keyLatency: 50, idleCpuPct: 10 };

const reportDir = process.env.PD_SHOT_DIR || join(process.cwd(), 'test-results');
const report: Record<string, unknown> = {
  machine: { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, totalMemGB: Math.round(totalmem() / 1e9) },
  note: '務實 N 量測（嚴謹 30 次 p95 + 基準機規格留 ship 量一次）',
  budgets: BUDGET,
};

function p95(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * 0.95) - 1))];
}
const mainMeasures = (app: ElectronApplication, name: string): Promise<number[]> =>
  app.evaluate((_e, n) => {
    const g = (globalThis as unknown as { __pdPerf?: { getMeasures(x: string): number[] } }).__pdPerf;
    return g ? g.getMeasures(n) : [];
  }, name);
const rendererMeasures = (page: Page, name: string): Promise<number[]> =>
  page.evaluate((n) => {
    const g = (window as unknown as { __pdPerf?: { getMeasures(x: string): number[] } }).__pdPerf;
    return g ? g.getMeasures(n) : [];
  }, name);

function seedWs(prefix: string, files: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'pdperf-'));
  const dir = join(root, prefix);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), `content of ${f}\nline2\n`);
  return dir;
}

test.afterAll(() => {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'perf-report.json'), JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log('\n=== PERF REPORT ===\n' + JSON.stringify(report, null, 2));
});

test('REQ-PERF-001 冷啟動 p95 < 3s', async () => {
  test.setTimeout(240_000);
  const cold: number[] = [];
  for (let i = 0; i < N_COLD; i++) {
    const { app, page, userData } = await launchApp();
    await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible({ timeout: 20000 });
    cold.push(...(await mainMeasures(app, 'coldStart')));
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
  const v = p95(cold);
  report.coldStart = { p95: Math.round(v), n: cold.length, budget: BUDGET.coldStart, samples: cold.map((x) => Math.round(x)) };
  expect(cold.length).toBeGreaterThanOrEqual(N_COLD);
  expect(v).toBeLessThan(BUDGET.coldStart);
});

test('REQ-PERF-002/003/004 切換 / 開檔 / 按鍵 p95', async () => {
  test.setTimeout(240_000);
  const files = Array.from({ length: N_FILE }, (_, i) => `f${i}.txt`);
  const dirA = seedWs('perf-a', files);
  const dirB = seedWs('perf-b');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dirA, dirB]);
  await addWorkspaceViaUI(page);
  await addWorkspaceViaUI(page);

  // 先各載入一次（firstLoad，不計入 wsSwitch 桶），再來回切換量 wsSwitch。
  await page.locator('button[aria-label="開啟工作區 perf-a"]').click();
  await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible();
  await page.locator('button[aria-label="開啟工作區 perf-b"]').click();
  await page.waitForTimeout(300);
  for (let i = 0; i < N_SWITCH; i++) {
    await page.locator(`button[aria-label="開啟工作區 perf-${i % 2 === 0 ? 'a' : 'b'}"]`).click();
    await page.waitForTimeout(80);
  }
  const sw = await rendererMeasures(page, 'wsSwitch');
  report.wsSwitch = { p95: Math.round(p95(sw)), n: sw.length, budget: BUDGET.wsSwitch };

  // 開檔：回到 A，逐一開 N 個檔（每次觸發 fileOpen 埋點）。
  await page.locator('button[aria-label="開啟工作區 perf-a"]').click();
  await page.waitForTimeout(200);
  for (const f of files) {
    await page.getByText(f, { exact: true }).first().click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(120);
  }
  const fo = await rendererMeasures(page, 'fileOpen');
  report.fileOpen = { p95: Math.round(p95(fo)), n: fo.length, budget: BUDGET.fileOpen };

  // 按鍵延遲：開終端機、聚焦 xterm、逐鍵輸入（PTY echo 回流記一次往返延遲）。
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first()).toBeVisible({ timeout: 15000 });
  await page.locator('.xterm-screen, .xterm').first().click();
  await page.waitForTimeout(500);
  for (let i = 0; i < N_KEY; i++) {
    await page.keyboard.type('a', { delay: 30 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(400);
  const kl = await rendererMeasures(page, 'keyLatency');
  report.keyLatency = { p95: Math.round(p95(kl)), n: kl.length, budget: BUDGET.keyLatency };

  await app.close();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });

  // 樣本數下限（防 under-sampling 假綠：若埋點退化只 fire 一次，p95=該單一樣本即蒙混過關）。
  expect(sw.length, 'wsSwitch 樣本數').toBeGreaterThanOrEqual(N_SWITCH);
  expect(p95(sw), 'wsSwitch p95').toBeLessThan(BUDGET.wsSwitch);
  expect(fo.length, 'fileOpen 樣本數').toBeGreaterThanOrEqual(N_FILE);
  expect(p95(fo), 'fileOpen p95').toBeLessThan(BUDGET.fileOpen);
  expect(kl.length, 'keyLatency 樣本數').toBeGreaterThanOrEqual(Math.floor(N_KEY * 0.6)); // echo 往返時序變異，留餘裕
  expect(p95(kl), 'keyLatency p95').toBeLessThan(BUDGET.keyLatency);
});

test('REQ-MON-006 N=10 背景閒置監控 CPU 低水位', async () => {
  test.setTimeout(240_000);
  const dirs = Array.from({ length: N_IDLE_WS }, (_, i) => seedWs(`idle-${i}`));
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, dirs);
  for (let i = 0; i < N_IDLE_WS; i++) await addWorkspaceViaUI(page);
  await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible();
  await page.waitForTimeout(1500); // 讓監控進入穩態輪詢

  const c0 = await app.evaluate(() => process.cpuUsage());
  await page.waitForTimeout(IDLE_WINDOW_MS);
  const c1 = await app.evaluate(() => process.cpuUsage());
  const cpuMicros = c1.user + c1.system - (c0.user + c0.system);
  const cpuPct = (cpuMicros / 1000 / IDLE_WINDOW_MS) * 100; // 佔單核百分比
  report.idleCpu = { pct: Math.round(cpuPct * 10) / 10, workspaces: N_IDLE_WS, windowMs: IDLE_WINDOW_MS, budget: BUDGET.idleCpuPct };

  await app.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });

  expect(cpuPct, '閒置監控 CPU%（單核）').toBeLessThan(BUDGET.idleCpuPct);
});
