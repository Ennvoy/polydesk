// toolbar「終端機」按鈕顯隱：隱藏＝group.setVisible(false)（不 dispose、splitview 收容器騰出空間）、
// xterm/PTY 原地存活、再開即現。斷言用 aria-pressed（toggle 狀態）+ pane 高度收 0（真騰空間）+ keepmark（未 dispose）。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('toggle 終端機顯隱：setVisible 不 dispose、隱藏騰出空間、再開原地重現', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-tg-'));
  const dir = join(root, 'tg-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 tg-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  const pane = page.locator('.pd-term-view').first();
  await expect(pane).toBeVisible({ timeout: 15000 });

  // 標記終端機 DOM：顯隱後同一 element（含標記）仍在 = 沒被 dispose 重建（setVisible 核心：PTY/畫面原地保留）。
  await page.evaluate(() => document.querySelector('.pd-term-view')?.setAttribute('data-keepmark', 'TG1'));

  const toggleBtn = page.locator('button[aria-label="切換終端機顯示"]');
  await toggleBtn.click(); // 隱藏（group.setVisible(false)）
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  // 視覺騰出空間：終端機 pane 高度被 splitview 收到 ≈ 0（證明 setVisible 真隱藏、非僅設旗標）。
  await expect
    .poll(
      async () => {
        const b = await pane.boundingBox();
        return b ? Math.round(b.height) : 0;
      },
      { timeout: 8000 },
    )
    .toBeLessThan(20);

  await toggleBtn.click(); // 再開（group.setVisible(true)）
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(pane).toBeVisible({ timeout: 10000 });
  // 同一 DOM（標記未失）= 未 dispose；PTY/scrollback 原地存活。
  await expect(page.locator('.pd-term-view[data-keepmark="TG1"]')).toBeVisible({ timeout: 10000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
