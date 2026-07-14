// 終端機剪貼簿雙向 e2e（dogfood 回報：Ctrl+V/右鍵貼不上；Claude Code 選取複製 copied 假成功）。
// 貼上：xterm 預設把 Ctrl+V 綁成送 ^V（不貼上）、右鍵原生無貼上 → TerminalView 自行接管
//   （clipboard IPC → term.paste）。走真實鏈路：真 electron clipboard 放建檔指令 → 真終端機
//   Ctrl+V / 右鍵 → Enter 讓真 shell 執行 → 斷言檔案真的被建出。
// 複製（OSC52）：Claude Code 等 TUI 的選取複製＝往 PTY 發 OSC52 寫入序列 → main 端 stripOsc52
//   攔截解出寫系統剪貼簿（D-OSC52-WRITE 拍板放寬；查詢方向照封）。e2e 於真 shell echo OSC52 →
//   斷言系統剪貼簿內容真的變成 payload。
// 剪貼簿衛生：測試會動真系統剪貼簿——一律先快照、finally 還原（曾污染使用者剪貼簿，dogfood 回報）。
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

const readClipboard = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText());

/** 快照現有系統剪貼簿 → 放入測試文字；回傳還原函式（finally 呼叫，不污染使用者剪貼簿）。 */
async function seedClipboard(app: ElectronApplication, text: string): Promise<() => Promise<void>> {
  const prev = await readClipboard(app);
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
  return async () => {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), prev).catch(() => undefined);
  };
}

test('Ctrl+V 把剪貼簿內容貼進終端機（真 shell 執行建檔）', async () => {
  const dir = seedDir('clip-ws');
  const markerDir = mkdtempSync(join(tmpdir(), 'pdclip-marker-'));
  const markerPath = join(markerDir, 'PDPASTE_CTRLV.txt');
  const { app, page, userData } = await launchApp();
  let restore: (() => Promise<void>) | null = null;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 clip-ws"]').click();
    await openTerminal(page);

    restore = await seedClipboard(app, `echo pdpaste > "${markerPath}"`);
    await page.locator('.pd-term-view').first().click(); // 聚焦 xterm helper textarea
    await page.keyboard.press('Control+v'); // → attachCustomKeyEventHandler 判為 paste → term.paste
    await page.waitForTimeout(800); // 等非同步 clipboard IPC + term.paste 落地
    await page.keyboard.press('Enter'); // 顯式 Enter 讓 shell 執行（不依賴 bracketed paste 是否自動執行）

    await expect.poll(() => existsSync(markerPath), { timeout: 20000, message: 'Ctrl+V 貼上的指令未執行' }).toBe(true);
  } finally {
    await restore?.();
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
  let restore: (() => Promise<void>) | null = null;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 clip-ws2"]').click();
    await openTerminal(page);

    restore = await seedClipboard(app, `echo pdpaste > "${markerPath}"`);
    const view = page.locator('.pd-term-view').first();
    await view.click(); // 先左鍵聚焦（無拖曳＝無選取）
    await view.click({ button: 'right' }); // 無選取 → contextmenu handler 執行貼上
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');

    await expect.poll(() => existsSync(markerPath), { timeout: 20000, message: '右鍵貼上的指令未執行' }).toBe(true);
  } finally {
    await restore?.();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(markerDir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test('同工作區兩個終端機：A 選取後 Ctrl+C 可複製到 B，無選取仍保留 SIGINT', async () => {
  const dir = seedDir('clip-two-term-ws');
  const { app, page, userData } = await launchApp();
  let restore: (() => Promise<void>) | null = null;
  const payload = `PD_A_TO_B_${Date.now()}`;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 clip-two-term-ws"]').click();
    await openTerminal(page);
    await openTerminal(page);
    await expect(page.locator('.pd-term-view')).toHaveCount(2);

    restore = await seedClipboard(app, 'SENTINEL_BEFORE_A_TO_B');
    await app.evaluate(({ ipcMain }) => {
      (globalThis as { __pdPtyWrites?: Array<{ termId?: string; data?: string }> }).__pdPtyWrites = [];
      ipcMain.on('pty:write', (_e, p: { termId?: string; data?: string }) => {
        (globalThis as { __pdPtyWrites?: Array<{ termId?: string; data?: string }> }).__pdPtyWrites?.push(p);
      });
    });

    const terminals = page.locator('.pd-term-view');
    const firstHost = terminals.nth(0).locator('[data-term-unicode]');

    // 無選取 Ctrl+C 必須繼續送 ^C，不能因支援一般複製鍵而破壞 SIGINT。
    await terminals.nth(0).click();
    await firstHost.evaluate((el) => {
      (el as unknown as { __pdTerm?: { clearSelection(): void; focus(): void } }).__pdTerm?.clearSelection();
      (el as unknown as { __pdTerm?: { clearSelection(): void; focus(): void } }).__pdTerm?.focus();
    });
    await page.keyboard.press('Control+c');
    await expect
      .poll(
        () => app.evaluate(() => (globalThis as { __pdPtyWrites?: Array<{ data?: string }> }).__pdPtyWrites?.map((p) => p.data ?? '').join('') ?? ''),
        { timeout: 5000, message: '無選取 Ctrl+C 未送出 SIGINT' },
      )
      .toContain('\x03');

    // 在 A 的 xterm buffer 放入並選取測試字串，走真實 Ctrl+C → clipboard IPC。
    await firstHost.evaluate(async (el, text) => {
      const term = (el as unknown as {
        __pdTerm?: {
          buffer: { active: { cursorX: number; cursorY: number } };
          write(data: string, callback: () => void): void;
          select(column: number, row: number, length: number): void;
          focus(): void;
        };
      }).__pdTerm;
      if (!term) throw new Error('找不到第一個 xterm 實例');
      const column = term.buffer.active.cursorX;
      const row = term.buffer.active.cursorY;
      await new Promise<void>((resolve) => term.write(text, resolve));
      term.select(column, row, text.length);
      term.focus();
    }, payload);
    await page.keyboard.press('Control+c');
    await expect.poll(() => readClipboard(app), { timeout: 5000, message: '終端機 A 的選取未寫入剪貼簿' }).toBe(payload);

    // 切到 B 貼上，斷言資料實際送往第二個 PTY，而非只停在剪貼簿。
    const beforePaste = await app.evaluate(
      () => (globalThis as { __pdPtyWrites?: Array<{ data?: string }> }).__pdPtyWrites?.length ?? 0,
    );
    await terminals.nth(1).click();
    await page.keyboard.press('Control+v');
    await expect
      .poll(
        () =>
          app.evaluate((start) => {
            const writes = (globalThis as { __pdPtyWrites?: Array<{ data?: string }> }).__pdPtyWrites ?? [];
            return writes.slice(start).map((p) => p.data ?? '').join('');
          }, beforePaste),
        { timeout: 5000, message: '終端機 B 未收到從 A 複製的內容' },
      )
      .toContain(payload);
  } finally {
    await restore?.();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test('OSC52 寫入：真 shell 發序列 → 系統剪貼簿更新（Claude Code 選取複製鏈路）', async () => {
  const dir = seedDir('clip-ws3');
  const { app, page, userData } = await launchApp();
  let restore: (() => Promise<void>) | null = null;
  const payload = `PD-OSC52-${Date.now()}`;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 clip-ws3"]').click();
    await openTerminal(page);

    const b64 = Buffer.from(payload, 'utf8').toString('base64');
    // 用貼上鏈路把「發 OSC52 的 PowerShell 指令」送進真 shell（同時再覆蓋一次貼上路徑）
    restore = await seedClipboard(app, `Write-Host "$([char]27)]52;c;${b64}$([char]7)"`);
    await page.locator('.pd-term-view').first().click();
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');

    // main 端 stripOsc52 應解出 payload 寫進系統剪貼簿（＝Claude Code copied 真的落地）
    await expect
      .poll(() => readClipboard(app), { timeout: 20000, message: 'OSC52 寫入未抵達系統剪貼簿' })
      .toBe(payload);
  } finally {
    await restore?.();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test('右鍵貼上防抖：300ms 內第二次右鍵只貼一次；窗過後可再貼', async () => {
  const dir = seedDir('clip-ws4');
  const { app, page, userData } = await launchApp();
  let restore: (() => Promise<void>) | null = null;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 clip-ws4"]').click();
    await openTerminal(page);

    // main 端累積 pty:write 資料流（數 token 出現次數＝實際貼上次數）
    await app.evaluate(({ ipcMain }) => {
      (globalThis as { __pdPty?: string }).__pdPty = '';
      ipcMain.on('pty:write', (_e, p: { data?: string }) => {
        (globalThis as { __pdPty?: string }).__pdPty += String(p && p.data ? p.data : '');
      });
    });
    restore = await seedClipboard(app, 'PD_DEBOUNCE_TOKEN');

    const view = page.locator('.pd-term-view').first();
    const screen = page.locator('.pd-term-view .xterm-screen').first();
    await view.click(); // 聚焦、無選取
    // 同一瞬間連發兩個 contextmenu（模擬裝置重複觸發/手快連點；從最深節點冒泡到 host handler）
    // → 防抖應只貼一次
    await screen.evaluate((el) => {
      const fire = (): void => {
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      };
      fire();
      fire();
    });
    await page.waitForTimeout(1000);
    let data = await app.evaluate(() => (globalThis as { __pdPty?: string }).__pdPty ?? '');
    expect(data.split('PD_DEBOUNCE_TOKEN').length - 1).toBe(1);

    // 防抖窗（300ms）過後再右鍵 → 允許再貼一次（防抖不是永久封鎖）
    await page.waitForTimeout(500);
    await screen.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });
    await page.waitForTimeout(1000);
    data = await app.evaluate(() => (globalThis as { __pdPty?: string }).__pdPty ?? '');
    expect(data.split('PD_DEBOUNCE_TOKEN').length - 1).toBe(2);
  } finally {
    await restore?.();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
