// 終端機管理三功能：拖曳排序 / 顯示-隱藏（隱藏但不關閉、輸出續接＝同一 xterm DOM）/ 雙擊改名。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

async function paneLabels(page: Page): Promise<string[]> {
  return page.locator('.pd-term-pane .pd-term-pane-label').allInnerTexts();
}

test('顯示/隱藏：隱藏一個終端機＝移出並排但不關閉（同一 xterm DOM 存活），再顯示即回來', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-mng-'));
  const dir = join(root, 'mng-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 mng-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-pane')).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15000 });

  // 標記第 2 個終端機的 xterm DOM：隱藏後同一 element 仍在＝未 dispose＝process/scrollback 存活。
  await page.evaluate(() => {
    const views = document.querySelectorAll('.pd-term-view');
    views[1]?.setAttribute('data-keepmark', 'HIDE2');
  });

  // 開「顯示/隱藏」→ 取消勾選 PowerShell 2。
  await page.locator('button[aria-label="顯示或隱藏終端機"]').click();
  await page.locator('.pd-term-showhide-item', { hasText: 'PowerShell 2' }).locator('input[type="checkbox"]').uncheck();

  // 並排只剩 1 個 pane（隱藏那個的標頭/版面消失）；但其 xterm DOM 仍存在（背景掛載＝未關閉）。
  await expect(page.locator('.pd-term-pane')).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('.pd-term-view[data-keepmark="HIDE2"]')).toHaveCount(1);
  // 隱藏的那個不可見（在背景 stash，display:none），但仍掛載。
  await expect(page.locator('.pd-term-view[data-keepmark="HIDE2"]')).toBeHidden();
  // 工具列顯示隱藏計數。
  await expect(page.locator('button[aria-label="顯示或隱藏終端機"]')).toContainText('1 隱藏');

  // 重新勾選 → pane 回來、且是同一個 xterm DOM（keepmark 還在＝真的沒關過）。
  await page.locator('.pd-term-showhide-item', { hasText: 'PowerShell 2' }).locator('input[type="checkbox"]').check();
  await expect(page.locator('.pd-term-pane')).toHaveCount(2, { timeout: 8000 });
  await expect(page.locator('.pd-term-view[data-keepmark="HIDE2"]')).toBeVisible({ timeout: 8000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test('雙擊迷你標頭 → 就地改名，未命名時自動編號', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-rn-'));
  const dir = join(root, 'rn-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 rn-ws"]').click();

  // 兩個同 shell → 自動編號 PowerShell 1 / PowerShell 2。
  await page.locator('button[aria-label="新增終端機"]').click();
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-pane')).toHaveCount(2, { timeout: 15000 });
  expect(await paneLabels(page)).toEqual(['PowerShell 1', 'PowerShell 2']);

  // 雙擊第 1 個標籤 → 出現輸入框 → 改成 build → Enter。
  await page.locator('.pd-term-pane-label').first().dblclick();
  const input = page.locator('.pd-term-pane-rename');
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('build');
  await input.press('Enter');

  await expect(page.locator('.pd-term-pane-label').first()).toHaveText('build', { timeout: 5000 });
  // 另一個仍自動編號（自訂名不影響它）。
  expect(await paneLabels(page)).toEqual(['build', 'PowerShell 2']);

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test('拖曳迷你標頭 → 調整並排順序', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-dnd-'));
  const dir = join(root, 'dnd-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 dnd-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-pane')).toHaveCount(2, { timeout: 15000 });

  // 改成穩定的自訂名 AAA / BBB（自訂名不隨位置重編號，才能追蹤順序）。
  await page.locator('.pd-term-pane-label').nth(0).dblclick();
  await page.locator('.pd-term-pane-rename').fill('AAA');
  await page.locator('.pd-term-pane-rename').press('Enter');
  await page.locator('.pd-term-pane-label').nth(1).dblclick();
  await page.locator('.pd-term-pane-rename').fill('BBB');
  await page.locator('.pd-term-pane-rename').press('Enter');
  expect(await paneLabels(page)).toEqual(['AAA', 'BBB']);

  // HTML5 DnD：把 BBB 的標頭拖到 AAA 標頭上 → 插到 AAA 前面。手動派發（Playwright 對原生 DnD 較穩）。
  const srcHead = page.locator('.pd-term-pane', { hasText: 'BBB' }).locator('.pd-term-pane-head');
  const tgtHead = page.locator('.pd-term-pane', { hasText: 'AAA' }).locator('.pd-term-pane-head');
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await srcHead.dispatchEvent('dragstart', { dataTransfer: dt });
  await page.waitForTimeout(60);
  await tgtHead.dispatchEvent('dragover', { dataTransfer: dt });
  await tgtHead.dispatchEvent('drop', { dataTransfer: dt });
  await srcHead.dispatchEvent('dragend', { dataTransfer: dt });

  await expect.poll(async () => paneLabels(page), { timeout: 8000 }).toEqual(['BBB', 'AAA']);

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
