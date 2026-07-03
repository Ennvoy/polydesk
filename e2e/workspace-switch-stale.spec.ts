// bug 修復驗證（bug1）：快速切換工作區時，前一個工作區的慢 git 載入（大 repo git status ~2s）
// 回來後不得覆蓋當前工作區（世代號取消 stale）。真實鏈路：真 git、真 IPC、真 UI 切換。
//
// 佈局：C=大 repo（本專案 junction，git status 慢）、A=空 dir（非 repo）。切到 git 視圖載入 C（in-flight），
// 立刻切到 A。修復前：C 的 status 2s 後回來覆蓋 → 顯示 C 的變更區（stale）；修復後：gen 丟棄 → 保持 A。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp, stubFolderPicker, addWorkspaceViaUI, makeTempDir, makeSubDir } from './electronApp';

test('bug1：快速切換時前一工作區的慢 git 載入不覆蓋當前（取消 stale）', async () => {
  const root = makeTempDir('pdstale-');
  const dirA = makeSubDir(root, 'ws-empty'); // 非 repo（切到它應顯示「尚未初始化」）
  const dirC = 'C:\\polydesk-dev'; // 大 repo（git status ~2s）
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dirA, dirC]);
    await addWorkspaceViaUI(page); // ws-empty（空狀態 CTA）
    await page.locator('button[aria-label="新增"]').click(); // rail「＋」
    await page.locator('button[aria-label="新增工作區"]').click();
    await page.locator('button[aria-label="信任並新增工作區"]').click(); // polydesk-dev（此刻 active）
    await expect(page.locator('.pdws-item')).toHaveCount(2);

    // 切到 git 視圖 → SourceControl 開始載入大 repo 的 git status（~2s，in-flight）
    await page.locator('button[aria-label="原始碼控制"]').click();
    await page.waitForTimeout(350); // 讓大 repo 的 refresh 過防抖、git status 確實已發出（但 2s 未回）

    // 立刻切到空 dir 工作區 → 大 repo 的載入變 stale
    await page.locator('button[aria-label="開啟工作區 ws-empty"]').click();

    // 應顯示空 dir 的「尚未初始化」
    await expect(page.locator('button[aria-label="初始化 git 儲存庫"]')).toBeVisible({ timeout: 10000 });

    // 等大 repo 的 stale git status（切走前已發出）回來；修復後 gen 丟棄它 → 初始化按鈕仍在（不被 stale 覆蓋）
    await page.waitForTimeout(2500);
    await expect(page.locator('button[aria-label="初始化 git 儲存庫"]')).toBeVisible();
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
