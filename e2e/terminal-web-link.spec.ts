// 終端機純文字網址真實鏈路：xterm buffer → LinkProvider → Ctrl+滑鼠點擊 → renderer/main
// HTTP(S) 雙層白名單 → shell.openExternal。一般點擊維持選字/TUI 操作，不得誤外開。
import { test, expect } from '@playwright/test';
import type { Terminal } from '@xterm/xterm';
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
    await expect(host).toHaveAttribute('data-initial-size-ready', 'true');

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

    await host.evaluate(async (el) => {
      const term = (el as HTMLElement & {
        __pdTerm?: Terminal;
      }).__pdTerm;
      if (!term) throw new Error('找不到 xterm 實例');
      await new Promise<void>((resolve) => term.write('\r\n入口🙂 http://localhost:3000', resolve));
    });
    const readLinkGeometry = () => host.evaluate((el) => {
      const term = (el as HTMLElement & {
        __pdTerm?: Terminal & {
          _core?: {
            _renderService?: {
              dimensions?: { css?: { cell?: { width: number; height: number } } };
            };
          };
        };
      }).__pdTerm;
      if (!term) throw new Error('找不到 xterm 實例');
      const cell = term._core?._renderService?.dimensions?.css?.cell;
      const rect = el.querySelector('.xterm-screen')!.getBoundingClientRect();
      const buffer = term.buffer.active;
      const marker = '入口🙂 http://localhost:3000';
      const url = 'http://localhost:3000';
      let bufferLine = -1;
      let lineText = '';
      let prefixCells: number | null = null;
      let urlStartCell = -1;
      let markerStartCell = -1;
      for (let y = 0; y < buffer.length; y++) {
        const line = buffer.getLine(y);
        if (!line?.translateToString(true).includes(marker)) continue;
        bufferLine = y;
        lineText = line.translateToString(true);
        // 與真正 LinkProvider 一樣逐格換算，跳過中文／emoji 的 width=0 續格。
        let text = '';
        const cells: Array<{ textStart: number; textEnd: number; column: number }> = [];
        for (let column = 0; column < line.length; column++) {
          const value = line.getCell(column);
          if (!value || value.getWidth() === 0) continue;
          const textStart = text.length;
          text += value.getChars() || ' ';
          cells.push({ textStart, textEnd: text.length, column });
        }
        const markerIndex = text.indexOf(marker);
        const urlIndex = markerIndex + marker.indexOf(url);
        const findCell = (index: number) => cells.find(c => index >= c.textStart && index < c.textEnd)?.column ?? -1;
        markerStartCell = findCell(markerIndex);
        urlStartCell = findCell(urlIndex);
        prefixCells = urlStartCell - markerStartCell;
        break;
      }
      const viewportRow = bufferLine - buffer.viewportY;
      const diagnostic = {
        cols: term.cols, rows: term.rows, baseY: buffer.baseY, viewportY: buffer.viewportY,
        cursorY: buffer.cursorY, bufferLine, URLLine: lineText, prefixCells,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        cell, initialReady: (el as HTMLElement).dataset.initialSizeReady,
      };
      if (!cell?.width || !cell.height || bufferLine < 0 || urlStartCell < 0 || markerStartCell < 0 ||
          viewportRow < 0 || viewportRow >= term.rows) return { point: null, diagnostic };
      // 點 URL 第 5 格的中點；相對畫面行取實際 bufferLine−viewportY，不猜 cursorY。
      const relativeX = cell.width * (urlStartCell + 4.5);
      const relativeY = cell.height * (viewportRow + 0.5);
      if (relativeX >= rect.width || relativeY >= rect.height) return { point: null, diagnostic };
      return {
        point: {
          x: rect.left + relativeX, y: rect.top + relativeY, relativeX, relativeY,
          nonUrlX: rect.left + cell.width * (markerStartCell + 0.5),
        },
        diagnostic,
      };
    });

    let point: { x: number; y: number; relativeX: number; relativeY: number; nonUrlX: number } | undefined;
    let lastDiagnostic: unknown;
    try {
      await expect
        .poll(
          async () => {
            const geometry = await readLinkGeometry();
            lastDiagnostic = geometry.diagnostic;
            if (!geometry.point) throw new Error(`網址已消失或不可定位：${JSON.stringify(lastDiagnostic)}`);
            expect(geometry.diagnostic.prefixCells).toBe(7);
            // resize 會清除 currentLink；每輪確實移出 URL 再移入，讓 xterm 重查真 buffer。
            await page.mouse.move(geometry.point.nonUrlX, geometry.point.y);
            await page.mouse.move(geometry.point.x, geometry.point.y);
            point = geometry.point;
            return host.evaluate((el) => {
              const term = (el as HTMLElement & {
                __pdTerm?: { _core?: { linkifier?: { currentLink?: { link?: { text?: string } } } } };
              }).__pdTerm;
              return term?._core?.linkifier?.currentLink?.link?.text ?? '';
            });
          },
          { timeout: 5_000, message: 'xterm LinkProvider 未在滑鼠位置啟用網址連結' },
        )
        .toBe('http://localhost:3000');
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n定位診斷：${JSON.stringify(lastDiagnostic)}`, { cause: error });
    }
    if (!point) throw new Error('網址辨識成功但缺少滑鼠點位');

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
