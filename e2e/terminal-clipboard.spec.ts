// 終端機貼上（dogfood 回報：在終端機裡跑 Claude Code 時 Ctrl+V 貼不上、右鍵也沒用）。
// xterm 預設把 Ctrl+V 綁成送控制字元 ^V（不貼上），右鍵原生亦無貼上；本 app 於 TerminalView
// 自行接管（讀剪貼簿 → term.paste）。此處走真實鏈路驗證：真 electron clipboard 放入一段建檔指令，
// 於真終端機按 Ctrl+V / 右鍵貼上 → 按 Enter 讓真 shell 執行 → 斷言「檔案真的被建出」（貼上的文字
// 確實抵達 PTY 並被 shell 收下）。用絕對路徑、只檢查檔案存在，故與 PowerShell/cmd 無關。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pdclip-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 開一個真終端機並等 xterm 掛載 + 給 shell 一點時間就緒（避免輸入早於 prompt）。 */
async function openTerminal(page: Page): Promise<void> {
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.pd-term-pane-label').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500); // shell（PowerShell/cmd）初始化 prompt
}

/** 把一段「建立 markerPath 檔案」的指令放進真 electron 系統剪貼簿。 */
async function seedClipboardCommand(app: ElectronApplication, markerPath: string): Promise<void> {
  const cmd = `echo pdpaste > "${markerPath}"`;
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), cmd);
}

test('Ctrl+V 把剪貼簿內容貼進終端機（真 shell 執行建檔）', async () => {
  const dir = seedDir('clip-ws');
  const markerDir = mkdtempSync(join(tmpdir(), 'pdclip-marker-'));
  const markerPath = join(markerDir, 'PDPASTE_CTRLV.txt');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 clip-ws"]').click();
    await openTerminal(page);

    await seedClipboardCommand(app, markerPath);
    await page.locator('.pd-term-view').first().click(); // 聚焦 xterm helper textarea
    await page.keyboard.press('Control+v'); // → attachCustomKeyEventHandler 判為 paste → term.paste
    await page.waitForTimeout(800); // 等非同步 clipboard IPC + term.paste 落地
    await page.keyboard.press('Enter'); // 顯式 Enter 讓 shell 執行（不依賴 bracketed paste 是否自動執行）

    await expect.poll(() => existsSync(markerPath), { timeout: 20000, message: 'Ctrl+V 貼上的指令未執行' }).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(markerDir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test('右鍵（無選取）貼上剪貼簿內容進終端機', async () => {
  const dir = seedDir('clip-ws2');
  const markerDir = mkdtempSync(join(tmpdir(), 'pdclip-marker-'));
  const markerPath = join(markerDir, 'PDPASTE_RCLICK.txt');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 clip-ws2"]').click();
    await openTerminal(page);

    await seedClipboardCommand(app, markerPath);
    const view = page.locator('.pd-term-view').first();
    await view.click(); // 先左鍵聚焦（無拖曳＝無選取）
    await view.click({ button: 'right' }); // 無選取 → contextmenu handler 執行貼上
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');

    await expect.poll(() => existsSync(markerPath), { timeout: 20000, message: '右鍵貼上的指令未執行' }).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(markerDir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
