// 側欄拖檔到終端機 → 貼上絕對路徑（VS Code 慣例）。真實鏈路：真檔案 seed → Explorer 樹 dragstart
// （真 DataTransfer、由 app 的 onDragStart 填 payload）→ 終端機 dragover/drop → pty:write 收到
// 絕對路徑（term.paste 走 bracketed paste，contains 斷言不受影響）。
// 另驗：含空白檔名要被引號包裹（PowerShell 單引號）；裸 text/plain（分頁拖曳排序的 payload）不觸發貼上。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

/** 開一個真終端機並等 xterm 掛載 + 給 shell 一點時間就緒。 */
async function openTerminal(page: Page): Promise<void> {
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.pd-term-pane-label').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
}

/** main 端累積 pty:write 資料流（斷言貼上內容的確定性 seam，同 terminal-clipboard 防抖測試）。 */
async function collectPtyWrites(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    (globalThis as { __pdPty?: string }).__pdPty = '';
    ipcMain.on('pty:write', (_e, p: { data?: string }) => {
      (globalThis as { __pdPty?: string }).__pdPty += String(p && p.data ? p.data : '');
    });
  });
}

const readPtyWrites = (app: ElectronApplication): Promise<string> =>
  app.evaluate(() => (globalThis as { __pdPty?: string }).__pdPty ?? '');

/** 對 Explorer 樹列 → 終端機做一次完整 HTML5 拖放握手（真 DataTransfer 流經 app 的雙方 handler）。 */
async function dragTreeItemToTerminal(page: Page, fileLabel: string): Promise<void> {
  const src = page.locator(`[role="tree"] [role="treeitem"][aria-label="${fileLabel}"]`);
  const dst = page.locator('.pd-term-view').first();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await src.dispatchEvent('dragstart', { dataTransfer: dt });
  await dst.dispatchEvent('dragenter', { dataTransfer: dt });
  await dst.dispatchEvent('dragover', { dataTransfer: dt });
  await dst.dispatchEvent('drop', { dataTransfer: dt });
  await src.dispatchEvent('dragend', { dataTransfer: dt });
}

test('側欄拖檔到終端機：貼上絕對路徑；含空白檔名自動包引號；裸 text/plain 不誤貼', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pddrop-'));
  const dir = join(root, 'drop-ws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plain.txt'), 'x');
  writeFileSync(join(dir, 'has space.txt'), 'x');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 drop-ws"]').click();
    await openTerminal(page);
    await collectPtyWrites(app);

    // 1) 一般檔名：裸貼絕對路徑
    await expect(page.locator('[role="tree"] [role="treeitem"][aria-label="plain.txt"]')).toBeVisible();
    await dragTreeItemToTerminal(page, 'plain.txt');
    await expect
      .poll(() => readPtyWrites(app), { timeout: 10000, message: '拖放後 pty 未收到絕對路徑' })
      .toContain(join(dir, 'plain.txt'));

    // 2) 含空白檔名：PowerShell 單引號包裹
    await dragTreeItemToTerminal(page, 'has space.txt');
    await expect
      .poll(() => readPtyWrites(app), { timeout: 10000, message: '含空白路徑未被引號包裹' })
      .toContain(`'${join(dir, 'has space.txt')}'`);

    // 3) 裸 text/plain（＝分頁拖曳排序的 payload 形態）不觸發貼上
    const before = await readPtyWrites(app);
    await page.locator('.pd-term-view').first().evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'PD_SHOULD_NOT_PASTE');
      for (const type of ['dragover', 'drop'] as const) {
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    });
    await page.waitForTimeout(800);
    const after = await readPtyWrites(app);
    expect(after).not.toContain('PD_SHOULD_NOT_PASTE');
    expect(after).toBe(before);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
