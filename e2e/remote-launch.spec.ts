import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

async function proxy(path: string, method: string, headers: Record<string, string>, body?: string) {
  return await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 49387, path, method, headers: { ...headers, Host: 'poly.test:8443', 'X-Forwarded-Proto': 'https' } }, res => {
      const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const out: Record<string, string> = {}; for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) out[key] = Array.isArray(value) ? value.join('\n') : value;
        resolve({ status: res.statusCode!, headers: out, body: Buffer.concat(chunks) });
      });
    }); req.on('error', reject); req.end(body);
  });
}
async function terminalText(page: Page) {
  return await page.evaluate(() => Array.from(document.querySelectorAll('[data-term-unicode]')).map(el => {
    const t = (el as unknown as { __pdTerm?: { buffer: { active: { length: number; getLine(y: number): { translateToString(trim: boolean): string } | undefined } } } }).__pdTerm;
    if (!t) return ''; return Array.from({ length: t.buffer.active.length }, (_, y) => t.buffer.active.getLine(y)?.translateToString(true) ?? '').join('\n');
  }).join('\n'));
}
test('真 HTTP 手機配對與桌面批准，縮小後新增固定 Claude GUI 分頁且同操作不重複', async ({}, testInfo) => {
  test.setTimeout(120000);
  const root = mkdtempSync(join(tmpdir(), 'pd-remote-e2e-')); const bin = join(root, 'bin');
  const ws1 = join(root, 'remote-workspace'); const ws2 = join(root, 'other-workspace');
  mkdirSync(bin); mkdirSync(ws1); mkdirSync(ws2);
  writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\necho REMOTE_CLAUDE_ARGS:%*\r\n', 'utf8');
  const { app, page, userData } = await launchApp({ env: { POLYDESK_E2E_REMOTE_GATEWAY: '1', PATH: `${bin};${process.env.PATH ?? ''}` } });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  try {
    await stubFolderPicker(app, [ws1, ws2]); await addWorkspaceViaUI(page); await addWorkspaceViaUI(page);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '啟用手機遠端啟動', exact: true }).click();
    await expect(page.getByText('已啟用 · 僅 Tailscale 私人 HTTPS')).toBeVisible();
    await page.getByRole('button', { name: '產生手機配對碼' }).click();
    const code = await page.locator('section[aria-label="手機遠端啟動"] code').textContent();
    expect(code).toMatch(/^[a-f0-9]{32}$/);
    await mobile.route('https://poly.test:8443/**', async route => {
      const r = route.request(); const u = new URL(r.url());
      const response = await proxy(u.pathname + u.search, r.method(), await r.allHeaders(), r.postData() ?? undefined);
      await route.fulfill(response);
    });
    await mobile.goto(`https://poly.test:8443/#pair=${code}`);
    await expect(mobile).toHaveURL('https://poly.test:8443/');
    await mobile.getByLabel('手機名稱').fill('拒絕測試手機'); await mobile.getByRole('button', { name: '送出配對申請' }).click();
    await expect(mobile.locator('#verify')).toBeVisible();
    await page.getByRole('button', { name: '拒絕', exact: true }).click();
    await expect(mobile.locator('#pair')).toBeVisible();
    await expect(mobile.locator('#status')).toContainText('拒絕');
    // Manual fallback shares the same single-use challenge and desktop approval pipeline.
    await page.getByRole('button', { name: '產生手機配對碼' }).click();
    const manual = await page.locator('section[aria-label="手機遠端啟動"] code').textContent();
    await mobile.getByLabel('一次性配對碼').fill(manual!);
    await mobile.getByLabel('手機名稱').fill('測試手機'); await mobile.getByRole('button', { name: '送出配對申請' }).click();
    await expect(mobile.locator('#verify')).toBeVisible();
    const verification = await mobile.locator('#verification').textContent();
    await expect(page.getByText(verification!, { exact: true })).toBeVisible();
    await page.getByLabel('配對期限 測試手機').selectOption('30');
    const qa = join(process.cwd(), '.constellation', 'qa', 'remote-launch'); mkdirSync(qa, { recursive: true });
    await page.getByText('等待批准的手機', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(qa, 'desktop-pending-30days.png') });
    await mobile.screenshot({ path: join(qa, 'mobile-pair-pending.png'), fullPage: true });
    await page.getByRole('button', { name: '識別碼相同，批准' }).click();
    await expect(mobile.locator('#empty')).toBeVisible();
    await page.getByLabel('remote-workspace', { exact: true }).click();
    await page.getByRole('button', { name: '信任並允許遠端啟動' }).click();
    await expect(page.getByLabel('remote-workspace', { exact: true })).toBeChecked();
    await mobile.getByRole('button', { name: '重新整理連線' }).click();
    await expect(mobile.getByRole('button', { name: '在 remote-workspace 開啟 Claude bypass' })).toBeVisible();
    await expect(mobile.getByText('other-workspace', { exact: true })).toHaveCount(0);
    for (const width of [320, 390]) {
      await mobile.setViewportSize({ width, height: 844 });
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mobile.screenshot({ path: `test-results/remote-mobile-${width}.png`, fullPage: true });
      copyFileSync(join(process.cwd(), 'test-results', `remote-mobile-${width}.png`), join(qa, `mobile-authorized-${width}.png`));
    }
    await page.getByRole('button', { name: '關閉設定', exact: true }).click();
    await page.getByRole('button', { name: '開啟工作區 other-workspace' }).click();
    await page.getByRole('button', { name: '切換終端機顯示' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('data:'))?.minimize());
    await mobile.getByRole('button', { name: '在 remote-workspace 開啟 Claude bypass' }).click();
    await expect(page.locator('.pd-term-pane-label')).toHaveText(['Claude bypass']);
    await expect.poll(() => terminalText(page)).toContain('REMOTE_CLAUDE_ARGS:--dangerously-skip-permissions');
    await expect(mobile.locator('#result')).toContainText('已新增 Claude bypass 分頁並送出啟動命令');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isMinimized()))).toBe(false);
    // Repeat the exact operation through the real HTTP endpoint: one PTY and one GUI tab.
    const repeat = await mobile.evaluate(async () => { const state = await (await fetch('/api/session')).json(); const op = JSON.parse(sessionStorage.getItem('poly-last-operation')!); return (await fetch('/api/launch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(op) })).status; });
    expect(repeat).toBe(200); await expect(page.locator('.pd-term-pane')).toHaveCount(1);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '撤銷 測試手機' }).click();
    await mobile.getByRole('button', { name: '重新整理連線' }).click();
    await expect(mobile.locator('#pair')).toBeVisible();
    await expect(page.locator('.pd-term-pane')).toHaveCount(1);
    await page.screenshot({ path: 'test-results/remote-desktop-settings.png' });
    copyFileSync(join(process.cwd(), 'test-results', 'remote-desktop-settings.png'), join(qa, 'desktop-revoked.png'));
    await page.getByRole('button', { name: '停用手機遠端啟動' }).click();
    await expect(page.getByText('已停用 · 無遠端監聽')).toBeVisible();
  } catch (error) {
    // Preserve only visible UI state and the public status API. Never capture
    // cookies, pairing codes, browser storage, or the raw authorization file.
    const diagnostic = await Promise.allSettled([
      terminalText(page),
      mobile.locator('#result').textContent(),
      mobile.locator('#status').textContent(),
      page.evaluate(() => window.polydesk.remote.status()),
      page.screenshot({ path: testInfo.outputPath('remote-launch-failure-desktop.png'), mask: [page.locator('section[aria-label="手機遠端啟動"] code'), page.getByAltText('手機配對 QR code')] }),
      mobile.screenshot({ path: testInfo.outputPath('remote-launch-failure-mobile.png'), fullPage: true, mask: [mobile.locator('input')] }),
    ]);
    const safe = diagnostic.slice(0, 4).map(result => result.status === 'fulfilled' ? result.value : { unavailable: String(result.reason) });
    writeFileSync(testInfo.outputPath('remote-launch-failure.json'), JSON.stringify({ terminalText: safe[0], mobileResult: safe[1], mobileStatus: safe[2], remoteStatus: safe[3] }, null, 2), 'utf8');
    throw error;
  } finally { await mobileContext.close(); await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});
