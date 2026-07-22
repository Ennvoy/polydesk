// 終端機檔案路徑連結真實鏈路：xterm buffer → LinkProvider → Ctrl+滑鼠點擊 → IPC 安全解析
// → editorBus 開檔並跳到指定行欄。測試直接把輸出寫進 xterm，避免依賴 shell prompt 文案與輸出時序。
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addWorkspaceViaUI, launchApp, makeSubDir, makeTempDir, stubFolderPicker } from './electronApp';

test('Ctrl+點擊終端機工作區路徑：在 Polydesk 編輯器開檔並跳到行欄', async () => {
  const root = makeTempDir('pd-term-link-');
  const dir = makeSubDir(root, 'link-ws');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'linked.ts'), ['line one', 'TARGET_LINE', 'line three'].join('\n'), 'utf8');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 link-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    const host = page.locator('.pd-term-view [data-term-unicode]').first();
    await expect(host).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500); // 等 PowerShell prompt 穩定，避免測試文字被後續初始化輸出推走

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
      await new Promise<void>((resolve) => term.write('\r\nsrc/linked.ts:2:3', resolve));
      const cell = term._core?._renderService?.dimensions?.css?.cell;
      if (!cell?.width || !cell.height) throw new Error('無法取得 xterm cell 尺寸');
      const rect = el.querySelector('.xterm-screen')!.getBoundingClientRect();
      return {
        x: rect.left + cell.width * 2,
        y: rect.top + cell.height * (term.buffer.active.cursorY + 0.5),
        relativeX: cell.width * 2,
        relativeY: cell.height * (term.buffer.active.cursorY + 0.5),
      };
    });

    // LinkProvider 在 hover 時非同步提供連結；先移入再 Ctrl+點擊，走使用者真實手勢。
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
        { timeout: 5_000, message: 'xterm LinkProvider 未在滑鼠位置啟用檔案連結' },
      )
      .toBe('src/linked.ts:2:3');
    await page.locator('.pd-term-view .xterm-screen').first().click({
      position: { x: point.relativeX, y: point.relativeY },
      modifiers: ['Control'],
    });

    await expect(page.locator('[role="tab"][aria-label^="linked.ts"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.monaco-editor').first()).toContainText('TARGET_LINE', { timeout: 15_000 });
    await expect(page.getByText('行 2，欄 3', { exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('工作區外檔案：主程序確認後才外開，危險腳本一律封鎖', async () => {
  const root = makeTempDir('pd-term-external-link-');
  const dir = makeSubDir(root, 'link-ws');
  const image = join(root, 'claude-shot.png');
  const script = join(root, 'unsafe.cmd');
  writeFileSync(image, 'fake image bytes', 'utf8');
  writeFileSync(script, 'echo unsafe', 'utf8');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 link-ws"]').click();
    await app.evaluate(({ dialog, shell }) => {
      const g = globalThis as {
        __pdExternalLinkDialogs?: unknown[];
        __pdExternalLinkOpened?: string[];
      };
      g.__pdExternalLinkDialogs = [];
      g.__pdExternalLinkOpened = [];
      const d = dialog as unknown as { showMessageBox: (...args: unknown[]) => Promise<{ response: number }> };
      d.showMessageBox = async (...args) => {
        g.__pdExternalLinkDialogs!.push(args.at(-1));
        return { response: 0 };
      };
      const s = shell as unknown as { openPath: (path: string) => Promise<string> };
      s.openPath = async (path) => {
        g.__pdExternalLinkOpened!.push(path);
        return '';
      };
    });

    const [imageResult, scriptResult] = await page.evaluate(async ([imagePath, scriptPath]) => {
      const api = (window as unknown as {
        polydesk: {
          workspace: { list: () => Promise<Array<{ id: string }>> };
          fs: { openTerminalLink: (req: { wsId: string; path: string }) => Promise<unknown> };
        };
      }).polydesk;
      const [ws] = await api.workspace.list();
      return Promise.all([
        api.fs.openTerminalLink({ wsId: ws.id, path: imagePath }),
        api.fs.openTerminalLink({ wsId: ws.id, path: scriptPath }),
      ]);
    }, [image, script] as const);

    expect(imageResult).toEqual({ kind: 'external', opened: true });
    expect(scriptResult).toEqual({ error: '基於安全考量，終端機連結不可啟動執行檔、腳本或捷徑' });
    const state = await app.evaluate(() => {
      const g = globalThis as { __pdExternalLinkDialogs?: unknown[]; __pdExternalLinkOpened?: string[] };
      return { dialogs: g.__pdExternalLinkDialogs ?? [], opened: g.__pdExternalLinkOpened ?? [] };
    });
    expect(state.opened).toEqual([image]);
    expect(state.dialogs).toEqual([
      expect.objectContaining({
        title: '開啟工作區外檔案',
        detail: image,
        defaultId: 1,
        cancelId: 1,
      }),
    ]);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
