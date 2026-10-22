// 主視窗 renderer 崩潰 → 失敗視窗 → 重試 → 主畫面恢復，並留下診斷 log。
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchRawApp } from './electronApp';

const isSplash = (url: string): boolean => url.startsWith('data:text/html');

test('renderer 崩潰後出現失敗視窗，重試可恢復主畫面並寫入診斷 log', async () => {
  // 不用 launchApp 的固定 12 秒等待：負載高時冷啟動會超過，改由 main 端輪詢標題列出現。
  const { app, userData } = await launchRawApp();
  const titlebarReady = (): Promise<boolean> => app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).find((w) => w.webContents.getURL().includes('/renderer/index.html'));
    if (!win || win.webContents.isCrashed()) return false;
    return win.webContents.executeJavaScript("!!document.querySelector('.pd-titlebar')").catch(() => false);
  });
  try {
    await expect.poll(titlebarReady, { timeout: 90_000 }).toBe(true);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).find((w) => w.webContents.getURL().includes('/renderer/index.html'))?.webContents.forcefullyCrashRenderer();
    });

    const findPage = (pred: (url: string) => boolean): Page | undefined =>
      app.windows().find((candidate) => !candidate.isClosed() && pred(candidate.url()));
    await expect.poll(() => findPage(isSplash) !== undefined, { timeout: 60_000 }).toBe(true);
    const splash = findPage(isSplash)!;
    await expect(splash.getByText('無法完成啟動')).toBeVisible();
    await expect(splash.locator('body')).toContainText('主畫面程序異常結束');
    const onTop = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).find((w) => w.webContents.getURL().startsWith('data:text/html'))?.isAlwaysOnTop());
    expect(onTop).toBe(true);

    await splash.getByRole('link', { name: '重試' }).click();

    // 崩潰後 Playwright 原 Page 控制代碼不會重新接上（Target crashed）；改由 main 端直接驗證主視窗 renderer 已重新載入且標題列存在，
    // 失敗視窗已關閉、主視窗可見。
    await expect.poll(titlebarReady, { timeout: 90_000 }).toBe(true);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).filter((w) => w.webContents.getURL().startsWith('data:text/html')).length), { timeout: 30_000 }).toBe(0);
    const mainVisible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).find((w) => w.webContents.getURL().includes('/renderer/index.html'))?.isVisible());
    expect(mainVisible).toBe(true);

    const logFile = join(userData, 'logs', 'main.log');
    expect(existsSync(logFile)).toBe(true);
    const entries = readFileSync(logFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; reason?: string; recovered?: boolean });
    expect(entries.filter((e) => e.kind === 'render-process-gone')).toHaveLength(1);
    expect(entries.some((e) => e.kind === 'app:start')).toBe(true);
    expect(entries.some((e) => e.kind === 'window:interactive' && e.recovered === true)).toBe(true);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
