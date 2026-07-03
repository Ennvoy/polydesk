// 終端機字型設定＋unicode11 寬度表驗證（真實鏈路：真 UI 點擊 → 真 IPC → 真 store 落檔）。
// - 預設字型 Consolas 14（對齊 VS Code）、設定面板即時切換、持久化 round-trip。
// - xterm 寬度表跑 Unicode 11（emoji 算 2 格＝與 ConPTY 一致，修狀態列重繪錯位亂碼）。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp, stubFolderPicker, addWorkspaceViaUI, makeTempDir, makeSubDir } from './electronApp';
import type { PersistState } from '../src/shared/types';

test('終端機字型：預設 Consolas 14 → 面板切 JetBrains Mono 即時套用並持久化；unicode11 生效', async () => {
  const root = makeTempDir('pdfont-');
  const dir = makeSubDir(root, 'font-ws');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 font-ws"]').click();

  // 開一個終端機（real PTY）→ 斷言 unicode11 寬度表已生效（診斷 seam）
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('[data-term-unicode="11"]').first()).toBeAttached({ timeout: 15000 });

  // 設定面板：預設顯示 Consolas 14
  await page.locator('button[aria-label="設定"]').first().click();
  await expect(page.getByText('目前：Consolas 14px', { exact: false })).toBeVisible();

  // 切 JetBrains Mono → 即時反映
  await page.locator('button[aria-label="終端機字型改用 JetBrains Mono"]').click();
  await expect(page.getByText('目前：JetBrains Mono 14px', { exact: false })).toBeVisible();

  // 持久化 round-trip：經真 preload IPC 讀回 store（main 端已 sanitize 落檔）
  const state = await page.evaluate<PersistState>(() =>
    (window as unknown as { polydesk: { store: { getState(): Promise<PersistState> } } }).polydesk.store.getState(),
  );
  expect(state.terminalFont).toEqual({ family: 'JetBrains Mono', size: 14 });

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
