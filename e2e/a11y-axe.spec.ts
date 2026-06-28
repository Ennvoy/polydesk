// X-3 a11y：axe 自動掃描（REQ-UI-004）。掃主要畫面狀態，斷言無 serious/critical 違規。
// 註：@axe-core/playwright 的 AxeBuilder 在 Electron 會 newPage（CDP 不支援）而失敗；改直接注入
// axe-core 引擎 source（經 page.evaluate / CDP evaluate 注入，繞過 production 嚴格 CSP），再 axe.run。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

// axe-core 為 @axe-core/playwright 的相依，必在 node_modules；取其 UMD bundle 注入頁面。
const axeSource = readFileSync(join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string;
  nodes: { target: unknown[] }[];
  help: string;
}

function seedWs(): string {
  const root = mkdtempSync(join(tmpdir(), 'pda11y-'));
  const dir = join(root, 'a11y-ws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'note.txt'), 'hello a11y\n');
  return dir;
}

async function scanSerious(page: Page, exclude?: string): Promise<unknown[]> {
  await page.evaluate(axeSource); // 注入 axe（CDP evaluate 不受頁面 CSP 限制）
  const violations = (await page.evaluate(async (ex) => {
    const ctx = ex ? ({ exclude: [[ex]] } as unknown) : document;
    // @ts-expect-error window.axe 由注入的 source 定義
    const r = await window.axe.run(ctx, { resultTypes: ['violations'] });
    return r.violations as AxeViolation[];
  }, exclude ?? null)) as AxeViolation[];
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.map((n) => n.target).slice(0, 4) }));
}

test('a11y：歡迎頁（無工作區）無 serious/critical 違規', async () => {
  const { app, page, userData } = await launchApp();
  await expect(page.getByText('還沒有工作區')).toBeVisible({ timeout: 15000 });
  const v = await scanSerious(page);
  // eslint-disable-next-line no-console
  console.log('WELCOME violations:', JSON.stringify(v, null, 2));
  expect(v, JSON.stringify(v, null, 2)).toEqual([]);
  await app.close();
  rmSync(userData, { recursive: true, force: true });
});

test('a11y：開工作區 + 開檔 + 終端機 主介面無 serious/critical 違規', async () => {
  const dir = seedWs();
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 a11y-ws"]').click();
  await page.getByText('note.txt', { exact: true }).first().click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('[role="tab"][aria-label^="PowerShell 終端機"]')).toBeVisible({ timeout: 15000 });

  // monaco 內部自有 a11y 處理，排除其子樹避免雜訊（聚焦 app 自有 UI）。
  const v = await scanSerious(page, '.monaco-editor');
  // eslint-disable-next-line no-console
  console.log('MAIN violations:', JSON.stringify(v, null, 2));
  expect(v, JSON.stringify(v, null, 2)).toEqual([]);

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
