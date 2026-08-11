import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { launchRawApp } from './electronApp';

const launched: { app: ElectronApplication; userData: string; child: ChildProcess }[] = [];

async function launchSplashApp(env: Record<string, string>): Promise<{ app: ElectronApplication; userData: string }> {
  const result = await launchRawApp({ env });
  launched.push({ ...result, child: result.app.process() });
  return result;
}

test.afterEach(async () => {
  for (const { app, userData, child } of launched.splice(0)) {
    await app.close().catch(() => undefined);
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 10_000 }).toBe(true);
    rmSync(userData, { recursive: true, force: true });
  }
});

async function waitForWindow(app: ElectronApplication, predicate: (url: string) => boolean): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => predicate(page.url())), { timeout: 20_000 }).toBe(true);
  const page = app.windows().find((candidate) => predicate(candidate.url()));
  if (!page) throw new Error('找不到符合條件的 Electron 視窗');
  return page;
}

const isSplash = (url: string): boolean => url.startsWith('data:text/html');
const isMain = (url: string): boolean => url.includes('/renderer/index.html') || url.includes('localhost');

test('splash 視窗建立後立即顯示，主視窗就緒後立即收尾', async () => {
  const { app } = await launchSplashApp({ POLYDESK_E2E_RENDERER_READY_DELAY_MS: '900' });
  const splash = await waitForWindow(app, isSplash);
  await expect(splash.getByText('正在準備工作區…')).toBeVisible();

  const native = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith('data:text/html'));
    if (!win) return null;
    const prefs = win.webContents.getLastWebPreferences();
    return {
      bounds: win.getBounds(),
      visible: win.isVisible(),
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
      sandbox: prefs.sandbox,
    };
  });
  expect(native).toMatchObject({
    bounds: { width: 420, height: 230 },
    visible: true,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
  const splashVisible = await app.evaluate(() => {
    const perf = (globalThis as unknown as { __pdPerf?: { getMeasures(name: string): number[] } }).__pdPerf;
    return perf?.getMeasures('splashVisible') ?? [];
  });
  expect(splashVisible).toHaveLength(1);
  expect(splashVisible[0]).toBeLessThan(200);

  const main = await waitForWindow(app, isMain);
  await expect(main.locator('.pd-shell')).toBeVisible();
  // React 外殼已提交但 renderer-ready 握手仍被測試 seam 延後時，splash 必須繼續顯示。
  await expect(splash.getByText('正在準備工作區…')).toBeVisible();
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('second-instance', {} as Electron.Event, [], '');
  });
  const visibilityDuringHandshake = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find((candidate) => candidate.webContents.getURL().includes('/renderer/index.html'));
    const splashWindow = windows.find((candidate) => candidate.webContents.getURL().startsWith('data:text/html'));
    return { main: mainWindow?.isVisible(), splash: splashWindow?.isVisible() };
  });
  expect(visibilityDuringHandshake).toEqual({ main: false, splash: true });
  await expect.poll(() => app.windows().some((page) => isSplash(page.url()))).toBe(false);
  const coldStart = await app.evaluate(() => {
    const perf = (globalThis as unknown as { __pdPerf?: { getMeasures(name: string): number[] } }).__pdPerf;
    return perf?.getMeasures('coldStart') ?? [];
  });
  expect(coldStart).toHaveLength(1);
  expect(coldStart[0]).toBeGreaterThan(0);
});

test('主畫面首次載入失敗時顯示安全原因，重試後可進入主程式', async () => {
  const { app, userData } = await launchSplashApp({ POLYDESK_E2E_MAIN_LOAD_MODE: 'fail-once' });
  const splash = await waitForWindow(app, isSplash);
  await expect(splash.getByText('無法完成啟動')).toBeVisible();
  await expect(splash.getByRole('link', { name: '重試' })).toBeVisible();
  await expect(splash.getByRole('link', { name: '退出' })).toBeVisible();
  await expect(splash.locator('body')).not.toContainText(userData);

  const opened = await splash.evaluate(() => window.open('https://example.com'));
  expect(opened).toBeNull();
  await splash.getByRole('link', { name: '重試' }).click();
  const main = await waitForWindow(app, isMain);
  await expect(main.locator('.pd-shell')).toBeVisible();
  await expect.poll(() => app.windows().some((page) => isSplash(page.url()))).toBe(false);
});

test('主畫面載入失敗時可從 splash 確實退出', async () => {
  const { app } = await launchSplashApp({ POLYDESK_E2E_MAIN_LOAD_MODE: 'fail-once' });
  const splash = await waitForWindow(app, isSplash);
  await expect(splash.getByText('無法完成啟動')).toBeVisible();
  const closed = app.waitForEvent('close');
  await splash.getByRole('link', { name: '退出' }).click();
  await closed;
});
