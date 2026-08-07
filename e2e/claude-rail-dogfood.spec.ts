// 真實 Claude 對話軸 smoke test：只啟動 claude 停在輸入列，不送 prompt、不呼叫模型、不消耗額度。
// 守住這次的修法：辨識靠 hook 的 termId 綁定（程序掃描在忙碌 Windows 上常整輪失效），且不看 buffer
// 型別——Claude Code 的 Ink TUI 跑在 normal buffer。兩者任一退回舊行為，軸就會變回「每個 scrollback
// 行一個節點」的密集刻度，這裡以節點數為 0（尚未提問）釘住。
import { expect, test } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorkspaceViaUI, launchApp, stubFolderPicker } from './electronApp';

test.skip(process.env.POLYDESK_DOGFOOD_CLAUDE_RAIL !== '1', '需要本機已安裝並登入 Claude Code');
test.setTimeout(120_000);

test('真實 Claude 啟動後對話軸接手，尚未提問時整條留白', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-claude-rail-'));
  const dir = join(root, 'claude-rail-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 claude-rail-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await page.locator('.pd-term-view').first().click();
    await page.keyboard.type('claude');
    await page.keyboard.press('Enter');

    // SessionStart hook 寫下帶 termId 的狀態檔 → 辨識為 claude → 對話軸接手。
    const rail = page.locator('.pd-term-navigation.is-messages');
    await expect(rail).toBeVisible({ timeout: 60_000 });
    // 還沒送出任何提問：軸上不該有任何節點（舊行為會是滿滿的 scrollback 行刻度）。
    await expect(rail.locator('.pd-term-navigation-node')).toHaveCount(0);
    await expect(page.locator('.pd-term-navigation-viewport')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
