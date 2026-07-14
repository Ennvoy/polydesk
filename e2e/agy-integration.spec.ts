// Agy 整合 UI：SCM 智慧 commit 引擎可選 Agy，切換後提示文字同步更新。
// 不在 E2E 真呼叫 agy --print，避免消耗模型額度與依賴登入狀態。
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('SCM 智慧 commit 引擎可選 Agy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-agy-'));
  const dir = join(root, 'agy-ws');
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 agy-ws"]').click();
  await page.locator('button[aria-label="原始碼控制"]').click();

  const engine = page.locator('select[aria-label="commit 訊息產生引擎"]');
  await expect(engine.locator('option[value="agy"]')).toHaveText('Agy');
  await engine.selectOption('agy');
  await expect(engine).toHaveValue('agy');
  await expect(page.locator('button[aria-label="智慧產生 commit 訊息（依已暫存的變更）"]')).toHaveAttribute('title', /用 Agy/);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});
