// 右鍵貼上 × TUI 滑鼠模式（claude 雙貼病根回歸）：TUI 開滑鼠回報（?1002/?1006）時，
// 右鍵手勢由 app 全權處理——xterm 不得把右鍵按下/放開回報寫進 PTY（該回報緊貼 bracketed
// paste 會讓 ConPTY/TUI 輸入解析偶發把貼上套用兩次），且貼上內容恰寫入一次。
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pdrctui-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 快照系統剪貼簿 → 放測試 marker；回傳還原函式。 */
async function seedClipboard(app: ElectronApplication, text: string): Promise<() => Promise<void>> {
  const prev = await app.evaluate(({ clipboard }) => clipboard.readText());
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
  return async () => {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), prev).catch(() => undefined);
  };
}

test('TUI 滑鼠模式下右鍵貼上：PTY 不收滑鼠回報、marker 恰寫入一次', async () => {
  const dir = seedDir('rctui-ws');
  const { app, page, userData } = await launchApp();
  const restore = { fn: null as null | (() => Promise<void>) };
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 rctui-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500); // shell 初始化 prompt

    // 模擬 TUI：對輸出流送 DECSET 開滑鼠回報（1002 按鍵事件 + 1006 SGR 編碼）→ xterm 進入回報模式
    await page.locator('.pd-term-view').first().click();
    await page.keyboard.type('[Console]::Write("$([char]27)[?1002h$([char]27)[?1006h")');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    // main 端記錄 renderer 之後所有 pty:write
    await app.evaluate(({ ipcMain }) => {
      (globalThis as { __w?: string[] }).__w = [];
      ipcMain.on('pty:write', (_e, p: { data?: unknown }) => {
        (globalThis as unknown as { __w: string[] }).__w.push(String(p && p.data));
      });
    });

    restore.fn = await seedClipboard(app, 'RCTUIMARK');
    const box = (await page.locator('.pd-term-view').first().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(1000);

    const writes = await app.evaluate(() => (globalThis as unknown as { __w: string[] }).__w);
    const mouseReports = writes.filter((w) => w.includes('\x1b[<'));
    const pastes = writes.filter((w) => w.includes('RCTUIMARK'));
    expect(mouseReports, `右鍵不得產生滑鼠回報寫入，實得：${JSON.stringify(mouseReports)}`).toEqual([]);
    expect(pastes.length, `貼上內容應恰寫入一次，實得 ${pastes.length} 次`).toBe(1);
  } finally {
    await restore.fn?.();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
