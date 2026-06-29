// 終端機標頭整併（dockview 分頁列隱藏，只剩面板自帶標頭）+ 面板「✕」真隱藏（removePanel）+ 重開接回 session。
// 註：scrollback 還原由 @xterm/addon-serialize 序列化/還原（隱藏前存、重開寫回）；xterm 在 e2e 走 webgl/canvas
// 渲染、文字不在 DOM，無法以 e2e 斷言畫面內容，故 scrollback 留 dogfood 驗（程式為標準 serialize 模式）。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('面板 ✕ 真隱藏（removePanel）+ 工具列再開接回 session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-th-'));
  const dir = join(root, 'th-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 th-ws"]').click();

  await page.locator('button[aria-label="新增終端機"]').click();
  const tab = page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first();
  await expect(tab).toBeVisible({ timeout: 15000 });
  // 打點字（讓序列化有內容可存；scrollback 還原由 dogfood 驗）。
  await page.locator('.pd-term-view .xterm-screen, .pd-term-view .xterm').first().click();
  await page.keyboard.type('echo hi');

  // 面板自帶「✕」→ 真隱藏（removePanel 騰出空間；面板控制鈕消失於視圖）。
  await page.locator('button[aria-label="隱藏終端機面板"]').click();
  await expect(page.locator('button[aria-label="新增終端機"]')).toBeHidden({ timeout: 8000 });

  // 工具列「終端機」鈕再開 → pane 接回（PTY 未被殺）。
  await page.locator('button[aria-label="切換終端機顯示"]').click();
  await expect(tab).toBeVisible({ timeout: 12000 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
