// 真實 Agy dogfood：預設跳過，避免 CI 消耗模型額度；只有明確設定 POLYDESK_DOGFOOD_AGY=1 才執行。
// 驗證真 Electron + 真 PTY + 真 agy.exe 狀態徽章，並實際消耗一次額度產生 commit message（不 commit）。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test.skip(process.env.POLYDESK_DOGFOOD_AGY !== '1', '需明確允許消耗 Agy 額度');
test.setTimeout(180_000);

test('Agy 真實程序已停止徽章 + 實際產生 commit 訊息', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-agy-dogfood-'));
  const dir = join(root, 'agy-dogfood-ws');
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'dogfood@polydesk.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Polydesk Dogfood'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'agy-dogfood.txt'), '驗證 Agy commit 訊息整合\n', 'utf8');
  execFileSync('git', ['add', 'agy-dogfood.txt'], { cwd: dir, stdio: 'pipe' });

  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 agy-dogfood-ws"]').click();

    // 真 PTY 啟動互動式 agy，不送 prompt、不消耗本次 commit 產生額度。
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500);
    await page.locator('.pd-term-view').first().click();
    await page.keyboard.type('agy');
    await page.keyboard.press('Enter');

    // CLI 已啟動但尚未送 prompt，正確語意是「已停止」（等待使用者輸入），不是執行中。
    const agyBadge = page.getByRole('status', { name: 'Agy 狀態：已停止' });
    await expect(agyBadge).toBeVisible({ timeout: 35_000 });

    // 結束 Agy，驗證下一輪程序掃描後徽章消失。
    await page.locator('.pd-term-view').first().click();
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+c');
    await expect(agyBadge).toHaveCount(0, { timeout: 35_000 });

    // 真實呼叫一次 agy --print 產生 commit 訊息；只回填 textarea，不執行 commit。
    await page.locator('button[aria-label="原始碼控制"]').click();
    const engine = page.locator('select[aria-label="commit 訊息產生引擎"]');
    await engine.selectOption('agy');
    await page.locator('button[aria-label="智慧產生 commit 訊息（依已暫存的變更）"]').click();

    const message = page.locator('textarea[aria-label="commit 訊息"]');
    await expect
      .poll(
        async () => {
          const value = (await message.inputValue()).trim();
          if (value) return `message:${value}`;
          const error = (await page.locator('.pd-scm-error').textContent().catch(() => null))?.trim();
          return error ? `error:${error}` : '';
        },
        { timeout: 110_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toMatch(/^message:/);
    expect((await message.inputValue()).trim()).toMatch(/^(feat|fix|chore|refactor|docs|test)\([^)]+\):/);
    await expect(page.locator('.pd-scm-error')).toHaveCount(0);

    // 確認只回填、沒有真的 commit：HEAD 仍不存在。
    expect(() => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe' })).toThrow();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
