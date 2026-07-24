// 終端機純文字網址真實鏈路：xterm buffer → LinkProvider → Ctrl+滑鼠點擊 → renderer/main
// HTTP(S) 雙層白名單 → shell.openExternal。一般點擊維持選字/TUI 操作，不得誤外開。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { addWorkspaceViaUI, launchApp, makeSubDir, makeTempDir, stubFolderPicker } from './electronApp';

test('Ctrl+點擊終端機 HTTP 網址：由系統瀏覽器外開，一般點擊不觸發', async () => {
  const root = makeTempDir('pd-term-web-link-');
  const dir = makeSubDir(root, 'web-link-ws');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 web-link-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    const host = page.locator('.pd-term-view [data-term-unicode]').first();
    await expect(host).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500);

    await app.evaluate(({ shell }) => {
      const g = globalThis as { __pdExternalUrls?: string[] };
      g.__pdExternalUrls = [];
      const s = shell as unknown as { openExternal: (url: string) => Promise<void> };
      s.openExternal = async (url) => {
        g.__pdExternalUrls!.push(url);
      };
    });
    // 先驗固定 IPC 與 main 白名單確實可達 stub；後段再驗 xterm 點擊會走同一條鏈路。
    expect(
      await page.evaluate(() =>
        (window as unknown as {
          polydesk: { app: { openExternalUrl: (req: { url: string }) => Promise<unknown> } };
        }).polydesk.app.openExternalUrl({ url: 'http://localhost:3000' }),
      ),
    ).toEqual({ opened: true });
    await app.evaluate(() => {
      (globalThis as { __pdExternalUrls?: string[] }).__pdExternalUrls = [];
    });
    expect(
      await page.evaluate(() =>
        (window as unknown as {
          polydesk: { app: { openExternalUrl: (req: { url: string }) => Promise<unknown> } };
        }).polydesk.app.openExternalUrl({ url: 'file:///C:/Windows/System32/calc.exe' }),
      ),
    ).toEqual({ error: 'invalid-url' });
    expect(await app.evaluate(() => (globalThis as { __pdExternalUrls?: string[] }).__pdExternalUrls ?? [])).toEqual([]);

    const point = await host.evaluate(async (el) => {
      const term = (el as HTMLElement & {
        __pdTerm?: {
          buffer: { active: { cursorY: number } };
          write(data: string, callback: () => void): void;
          _core?: {
            _renderService?: {
              dimensions?: { css?: { cell?: { width: number; height: number } } };
            };
          };
        };
      }).__pdTerm;
      if (!term) throw new Error('找不到 xterm 實例');
      await new Promise<void>((resolve) => term.write('\r\n入口🙂 http://localhost:3000', resolve));
      const cell = term._core?._renderService?.dimensions?.css?.cell;
      if (!cell?.width || !cell.height) throw new Error('無法取得 xterm cell 尺寸');
      const rect = el.querySelector('.xterm-screen')!.getBoundingClientRect();
      // 「入口🙂 」共 7 格，點 URL 內第 5 格；若誤拿 JS 字串索引會因中文/emoji 寬度而錯位。
      return {
        x: rect.left + cell.width * 12,
        y: rect.top + cell.height * (term.buffer.active.cursorY + 0.5),
        relativeX: cell.width * 12,
        relativeY: cell.height * (term.buffer.active.cursorY + 0.5),
      };
    });

    await page.mouse.move(point.x, point.y);
    await expect
      .poll(
        () =>
          host.evaluate((el) => {
            const term = (el as HTMLElement & {
              __pdTerm?: { _core?: { linkifier?: { currentLink?: { link?: { text?: string } } } } };
            }).__pdTerm;
            return term?._core?.linkifier?.currentLink?.link?.text ?? '';
          }),
        { timeout: 5_000, message: 'xterm LinkProvider 未在滑鼠位置啟用網址連結' },
      )
      .toBe('http://localhost:3000');

    const screen = page.locator('.pd-term-view .xterm-screen').first();
    await page.keyboard.down('Control');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up('Control');
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __pdExternalUrls?: string[] }).__pdExternalUrls ?? []))
      .toEqual(['http://localhost:3000/']);

    // 成功外開後再以一般左鍵點相同位置；陣列不得增加，證明不會搶走一般選字/TUI 操作。
    await screen.click({ position: { x: point.relativeX, y: point.relativeY } });
    await page.waitForTimeout(300);
    expect(await app.evaluate(() => (globalThis as { __pdExternalUrls?: string[] }).__pdExternalUrls ?? [])).toEqual([
      'http://localhost:3000/',
    ]);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
