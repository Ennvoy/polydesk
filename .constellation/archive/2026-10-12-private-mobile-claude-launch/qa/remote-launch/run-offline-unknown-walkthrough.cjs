'use strict';

// Supplemental UI walkthrough. Run from repository root after build, with no other Electron tests running.
// Uses the existing built Electron app, real PTY, system Chrome and real loopback
// HTTP service. Only the Tailscale gateway/native folder picker are E2E seams.
// Offline transport aborts requests; no API response/body is mocked.
const { createRequire } = require('node:module');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { request } = require('node:http');
const { randomUUID } = require('node:crypto');

const repo = process.cwd();
const requireRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron, chromium, expect: baseExpect } = requireRepo('@playwright/test');
const expect = baseExpect.configure({ timeout: 15000 });
const qa = __dirname;
const fixture = mkdtempSync(join(tmpdir(), 'pd-remote-offline-unknown-qa-'));
const userData = join(fixture, 'user-data');
const traffic = [];
const checks = [];
const cleanupErrors = [];
let app, browser, mobileContext, page;
let transportOffline = false;
let failure;

function passed(name, details = {}) {
  checks.push({ name, passed: true, ...details });
  console.log('PASS ' + name);
}
function forwardedLaunches() {
  return traffic.filter(t => t.method === 'POST' && t.path === '/api/launch' && t.forwarded).length;
}
function attemptedLaunches() {
  return traffic.filter(t => t.method === 'POST' && t.path === '/api/launch').length;
}
function resultGets(opId) {
  return traffic.filter(t => t.method === 'GET' && t.path === '/api/result/' + opId && t.forwarded).length;
}
function proxy(path, method, headers, body) {
  return new Promise((resolveResponse, reject) => {
    const req = request({
      hostname: '127.0.0.1', port: 49387, path, method,
      headers: { ...headers, Host: 'poly.test:8443', 'X-Forwarded-Proto': 'https' },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const out = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) out[key] = Array.isArray(value) ? value.join('\n') : value;
        }
        resolveResponse({ status: res.statusCode, headers: out, body: Buffer.concat(chunks) });
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('Loopback proxy timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
async function addWorkspace() {
  const direct = page.locator('button[aria-label="新增工作區"]').first();
  if (!(await direct.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="新增"]').first().click();
  }
  await page.locator('button[aria-label="新增工作區"]').first().click();
  await page.locator('button[aria-label="信任並新增工作區"]').click();
}
async function terminalText() {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-term-unicode]')).map(el => {
    const t = el.__pdTerm;
    if (!t) return '';
    return Array.from({ length: t.buffer.active.length }, (_, y) =>
      t.buffer.active.getLine(y)?.translateToString(true) ?? '').join('\n');
  }).join('\n'));
}
async function screenshot(mobile, name) {
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mobile.screenshot({ path: join(qa, name), fullPage: true });
}

(async () => {
  try {
    if (!existsSync(join(repo, 'out', 'main', 'index.js'))) throw new Error('Missing existing build; this script does not build');
    mkdirSync(qa, { recursive: true });
    mkdirSync(userData);
    const version = (file, constant) => {
      const match = readFileSync(join(repo, file), 'utf8').match(new RegExp('export const ' + constant + ' = (\\d+);'));
      if (!match) throw new Error('Cannot read current fixture version: ' + constant);
      return Number(match[1]);
    };
    writeFileSync(join(userData, 'state.json'), JSON.stringify({
      schemaVersion: version('src/main/store/schema.ts', 'CURRENT_SCHEMA_VERSION'),
      onboarding: { version: version('src/shared/constants.ts', 'ONBOARDING_VERSION'), status: 'completed', step: 0 },
    }), 'utf8');
    const bin = join(fixture, 'bin');
    const ws1 = join(fixture, 'remote-workspace');
    const ws2 = join(fixture, 'other-workspace');
    mkdirSync(bin); mkdirSync(ws1); mkdirSync(ws2);
    writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\necho REMOTE_CLAUDE_ARGS:%*\r\n', 'utf8');
    app = await electron.launch({
      args: [join(repo, 'out', 'main', 'index.js')], cwd: repo,
      env: { ...process.env, POLYDESK_USER_DATA: userData, POLYDESK_E2E_REMOTE_GATEWAY: '1', PATH: `${bin};${process.env.PATH ?? ''}` },
    });
    const deadline = Date.now() + 12000;
    while (!page && Date.now() < deadline) {
      page = app.windows().find(w => !w.url().startsWith('data:') &&
        (w.url().includes('/renderer/index.html') || w.url().includes('localhost')));
      if (!page) await new Promise(r => setTimeout(r, 25));
    }
    if (!page) throw new Error('Waiting for renderer timed out');
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ dialog }, paths) => {
      const q = [...paths];
      dialog.showOpenDialog = async () => ({ canceled: q.length === 0, filePaths: q.length ? [q.shift()] : [] });
    }, [ws1, ws2]);
    await addWorkspace(); await addWorkspace();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '啟用手機遠端啟動', exact: true }).click();
    await expect(page.getByText('已啟用 · 僅 Tailscale 私人 HTTPS')).toBeVisible();
    await page.getByRole('button', { name: '產生手機配對碼' }).click();
    const code = await page.locator('section[aria-label="手機遠端啟動"] code').textContent();
    expect(code).toMatch(/^[a-f0-9]{32}$/);

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', isMobile: true, hasTouch: true });
    const mobile = await mobileContext.newPage();
    await mobile.route('https://poly.test:8443/**', async route => {
      const r = route.request(); const u = new URL(r.url());
      // Playwright route.fulfill can bypass Chromium's offline network layer.
      // Respect the same offline toggle at the transport boundary: abort only;
      // every online response below comes from the real local HTTP service.
      const t = { method: r.method(), path: u.pathname + u.search, forwarded: !transportOffline };
      traffic.push(t);
      if (transportOffline) { await route.abort('internetdisconnected'); return; }
      const response = await proxy(t.path, t.method, await r.allHeaders(), r.postData() ?? undefined);
      t.status = response.status;
      await route.fulfill(response);
    });
    await mobile.goto('https://poly.test:8443/');
    await expect(mobile.locator('#pair')).toBeVisible();
    await mobile.getByLabel('一次性配對碼').fill(code);
    await mobile.getByLabel('手機名稱').fill('離線走查手機');
    await mobile.getByRole('button', { name: '送出配對申請' }).click();
    await expect(mobile.locator('#verify')).toBeVisible();
    const verification = await mobile.locator('#verification').textContent();
    await expect(page.getByText(verification, { exact: true })).toBeVisible();
    await page.getByLabel('配對期限 離線走查手機').selectOption('30');
    await page.getByRole('button', { name: '識別碼相同，批准' }).click();
    await expect(mobile.locator('#empty')).toBeVisible();
    await page.getByLabel('remote-workspace', { exact: true }).click();
    await page.getByRole('button', { name: '信任並允許遠端啟動' }).click();
    await mobile.getByRole('button', { name: '重新整理連線' }).click();
    const launchButton = mobile.getByRole('button', { name: '在 remote-workspace 開啟 Claude bypass' });
    await expect(launchButton).toBeVisible();
    await page.getByRole('button', { name: '關閉設定', exact: true }).click();
    await page.getByRole('button', { name: '開啟工作區 other-workspace' }).click();
    await page.getByRole('button', { name: '切換終端機顯示' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('data:'))?.minimize());
    await launchButton.click();
    await expect(page.locator('.pd-term-pane-label')).toHaveText(['Claude bypass']);
    await expect.poll(terminalText).toContain('REMOTE_CLAUDE_ARGS:--dangerously-skip-permissions');
    await expect(mobile.locator('#result')).toContainText('已新增 Claude bypass 分頁並送出啟動命令');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isMinimized()))).toBe(false);
    const original = await mobile.evaluate(() => JSON.parse(sessionStorage.getItem('poly-last-operation')));
    expect(original.opId).toMatch(/^[a-f0-9-]{36}$/);
    expect(forwardedLaunches()).toBe(1); expect(attemptedLaunches()).toBe(1);
    passed('Approved phone creates one real GUI tab and sends the fixed command');

    transportOffline = true;
    await mobileContext.setOffline(true);
    await mobile.getByRole('button', { name: '重新整理連線' }).click();
    await expect(mobile.locator('#status')).toContainText('無法連線：請確認電腦、Poly 與 Tailscale 已開啟');
    await expect(launchButton).toBeDisabled();
    await mobile.getByRole('button', { name: '查詢同一操作的結果' }).click();
    await expect(mobile.locator('#result')).toContainText('連線中斷，結果不確定。恢復後查詢同一操作，請勿連按建立新分頁。');
    await screenshot(mobile, 'mobile-offline-walkthrough.png');
    expect(attemptedLaunches()).toBe(1);
    await expect(page.locator('.pd-term-pane')).toHaveCount(1);
    passed('Offline refresh/query show connection failure and disable launch without queuing');

    transportOffline = false;
    await mobileContext.setOffline(false);
    const beforeRestoreGets = resultGets(original.opId);
    await mobile.getByRole('button', { name: '重新整理連線' }).click();
    await expect(mobile.locator('#status')).toHaveText('已配對 · 私有連線');
    await mobile.getByRole('button', { name: '查詢同一操作的結果' }).click();
    await expect(mobile.locator('#result')).toContainText('已新增 Claude bypass 分頁並送出啟動命令');
    await expect.poll(() => resultGets(original.opId)).toBeGreaterThan(beforeRestoreGets);
    expect(await mobile.evaluate(() => JSON.parse(sessionStorage.getItem('poly-last-operation')))).toEqual(original);
    expect(attemptedLaunches()).toBe(1); expect(forwardedLaunches()).toBe(1);
    await expect(page.locator('.pd-term-pane')).toHaveCount(1);
    await screenshot(mobile, 'mobile-restored-same-operation.png');
    passed('Restored connection queries the original operation without another POST or GUI tab');

    const missing = { wsId: original.wsId, opId: randomUUID() };
    await mobile.evaluate(op => sessionStorage.setItem('poly-last-operation', JSON.stringify(op)), missing);
    await mobile.reload();
    await expect(mobile.locator('#status')).toHaveText('已配對 · 私有連線');
    await expect(mobile.locator('#result')).toHaveText('查不到結果；請先查看電腦上的 Poly，再手動建立新操作。');
    await expect(launchButton).toBeDisabled();
    await expect(mobile.getByRole('button', { name: '已查看電腦，開始新的操作' })).toBeVisible();
    const beforeQueryGets = resultGets(missing.opId);
    await mobile.getByRole('button', { name: '查詢同一操作的結果' }).click();
    await expect.poll(() => resultGets(missing.opId)).toBeGreaterThan(beforeQueryGets);
    const afterManualGets = resultGets(missing.opId);
    // Observe at least one real two-second periodic GET; no arbitrary sleep.
    await expect.poll(() => resultGets(missing.opId), { timeout: 6000 }).toBeGreaterThan(afterManualGets);
    await expect(mobile.locator('#result')).toHaveText('查不到結果；請先查看電腦上的 Poly，再手動建立新操作。');
    expect(attemptedLaunches()).toBe(1); expect(forwardedLaunches()).toBe(1);
    await expect(page.locator('.pd-term-pane')).toHaveCount(1);
    await screenshot(mobile, 'mobile-unknown-walkthrough.png');
    passed('Unknown UUID restores through real GET, stays blocked and offers desktop-check acknowledgement; no automatic POST');

    await page.bringToFront();
    await expect(page.locator('.pd-term-pane-label')).toHaveText(['Claude bypass']);
    await mobile.getByRole('button', { name: '已查看電腦，開始新的操作' }).click();
    await expect(mobile.locator('#resultSection')).toBeHidden();
    await expect(launchButton).toBeEnabled();
    expect(await mobile.evaluate(() => sessionStorage.getItem('poly-last-operation'))).toBeNull();
    expect(attemptedLaunches()).toBe(1);
    await expect(page.locator('.pd-term-pane')).toHaveCount(1);
    passed('Explicit desktop-check acknowledgement clears the unknown result without launching');
  } catch (error) {
    failure = error;
    console.error(error.stack || String(error));
  } finally {
    // Each owner closes independently even if an earlier cleanup action fails.
    async function cleanup(name, action) {
      try { await action(); } catch (error) { cleanupErrors.push({ name, error: String(error) }); }
    }
    if (page && !page.isClosed()) await cleanup('Disable owned remote listener', () => page.evaluate(() => window.polydesk.remote.disable()));
    if (mobileContext) await cleanup('Close mobile context', () => mobileContext.close());
    if (browser) await cleanup('Close owned Chrome', () => browser.close());
    if (app) await cleanup('Close owned Electron and PTY', () => app.close());
    await cleanup('Remove only this owned TEMP fixture', () => {
      const owned = resolve(fixture);
      if (dirname(owned).toLowerCase() !== resolve(tmpdir()).toLowerCase() ||
          !owned.split(/[\\/]/).pop().startsWith('pd-remote-offline-unknown-qa-')) {
        throw new Error('Refusing cleanup outside owned TEMP fixture');
      }
      rmSync(owned, { recursive: true, force: true });
    });
    mkdirSync(qa, { recursive: true });
    const evidence = {
      status: failure || cleanupErrors.length ? 'FAIL' : 'PASS',
      timestamp: new Date().toISOString(),
      scope: 'Supplemental frozen-build real Electron/PTY/Chrome/HTTP UI walkthrough; no source edits or rebuild',
      limitation: 'Tailscale gateway uses existing unpackaged E2E seam; fake Claude executable checks the fixed command, not real Claude login/readiness',
      checks, launchAttempts: attemptedLaunches(), forwardedLaunches: forwardedLaunches(),
      offlineTransportAborts: traffic.filter(t => !t.forwarded).length,
      resultQueries: traffic.filter(t => t.method === 'GET' && t.path.startsWith('/api/result/') && t.forwarded).length,
      screenshots: ['mobile-offline-walkthrough.png', 'mobile-restored-same-operation.png', 'mobile-unknown-walkthrough.png'],
      cleanupErrors,
      error: failure ? String(failure) : undefined,
    };
    writeFileSync(join(qa, 'offline-unknown-walkthrough.txt'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    console.log('Evidence: ' + join(qa, 'offline-unknown-walkthrough.txt'));
    if (failure || cleanupErrors.length) process.exitCode = 1;
  }
})();
