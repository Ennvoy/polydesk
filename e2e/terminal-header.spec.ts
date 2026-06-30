// 面板「✕」隱藏（group.setVisible(false)，不 dispose）+ 工具列再開即現。（dockview 群組標頭已恢復顯示＝撤
// hideTerminalHeader，讓群組邊界可見、避免誤合併成分頁；本測試只驗面板自帶 ✕ 的 setVisible 隱藏行為。）
// 註：顯隱改 setVisible 後 xterm buffer 原地存活＝畫面/scrollback 自然保留。斷言用 aria-pressed（toggle 狀態）
// + pane 高度收 0（真騰空間）+ keepmark（同一 DOM 未 dispose）。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('面板 ✕ 隱藏（setVisible，不 dispose）+ 工具列再開即現', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-th-'));
  const dir = join(root, 'th-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 th-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  const pane = page.locator('.pd-term-view').first();
  await expect(pane).toBeVisible({ timeout: 15000 });
  // 打點字（讓畫面有內容；setVisible 隱藏不 dispose、重開內容原地保留）。
  await page.locator('.pd-term-view .xterm-screen, .pd-term-view .xterm').first().click();
  await page.keyboard.type('echo hi');
  // 標記終端機 DOM：顯隱後同一 element 仍在 = 未 dispose。
  await page.evaluate(() => document.querySelector('.pd-term-view')?.setAttribute('data-keepmark', 'TH1'));

  // 面板自帶「✕」→ 隱藏（toggleLayoutPanel('terminal') → group.setVisible(false) 騰出空間，不 dispose）。
  await page.locator('button[aria-label="隱藏終端機面板"]').click();
  const toggleBtn = page.locator('button[aria-label="切換終端機顯示"]');
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  // 視覺騰出空間：終端機 pane 高度收到 ≈ 0。
  await expect
    .poll(
      async () => {
        const b = await pane.boundingBox();
        return b ? Math.round(b.height) : 0;
      },
      { timeout: 8000 },
    )
    .toBeLessThan(20);

  // 工具列「終端機」鈕再開 → pane 立即重現（同一 DOM、xterm/PTY 原地存活）。
  await toggleBtn.click();
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(page.locator('.pd-term-view[data-keepmark="TH1"]')).toBeVisible({ timeout: 12000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
