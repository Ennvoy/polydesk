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

test('主視窗就緒前不顯示 Electron loading 視窗，renderer 握手後才顯示主畫面', async () => {
  const { app } = await launchSplashApp({ POLYDESK_E2E_RENDERER_READY_DELAY_MS: '2500' });
  const main = await waitForWindow(app, isMain);
  await expect(main.locator('.pd-shell')).toBeVisible();
  // React 外殼已提交但 renderer-ready 握手被延後時，不可提前顯示主窗。
  expect(app.windows().some((page) => isSplash(page.url()))).toBe(false);
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('second-instance', {} as Electron.Event, [], '');
  });
  const visibilityDuringHandshake = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find((candidate) => candidate.webContents.getURL().includes('/renderer/index.html'));
    const splashWindow = windows.find((candidate) => candidate.webContents.getURL().startsWith('data:text/html'));
    return { main: mainWindow?.isVisible(), splash: splashWindow?.isVisible() ?? false };
  });
  expect(visibilityDuringHandshake).toEqual({ main: false, splash: false });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('/renderer/index.html'));
    return mainWindow?.isVisible() ?? false;
  })).toBe(true);
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

test('初始化首次失敗後在同一程序重試成功', async () => {
  const { app } = await launchSplashApp({ POLYDESK_E2E_INIT_MODE: 'fail-once' });
  const originalPid = app.process().pid;
  const failure = await waitForWindow(app, isSplash);
  await expect(failure.getByText('無法完成啟動')).toBeVisible();
  await failure.getByRole('link', { name: '重試' }).click();
  const main = await waitForWindow(app, isMain);
  await expect(main.locator('.pd-shell')).toBeVisible();
  expect(app.process().pid).toBe(originalPid);
  await expect.poll(() => app.windows().some((page) => isSplash(page.url()))).toBe(false);
});
