import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { launchApp } from './electronApp';

function sessionStatus(): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 49387, path: '/api/session', headers: {
      Host: 'recovery.test.ts.net:8443', 'X-Forwarded-Proto': 'https',
    } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP session probe timed out')));
    req.on('error', reject); req.end();
  });
}

test('真 CLI 暫時失敗會暫停 HTTP，復原後自動受理，Funnel 停用原因重開仍保留', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Requires Windows .NET Framework console fixture');
  test.setTimeout(240000);
  const root = mkdtempSync(join(tmpdir(), 'pd-remote-recovery-'));
  const programFiles = join(root, 'ProgramFiles');
  const bin = join(programFiles, 'Tailscale');
  const userData = join(root, 'userData');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, 'tailscale.exe');
  const csc = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  let app: ElectronApplication | undefined;
  let page: Page | undefined;
  const startedAt = Date.now();
  const timestamps: Record<string, { at: string; elapsedMs: number }> = {};
  const mark = (phase: string): void => { timestamps[phase] = { at: new Date().toISOString(), elapsedMs: Date.now() - startedAt }; };
  mark('started');
  try {
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, join(process.cwd(), 'e2e', 'fixtures', 'remote-tailscale.cs')], { windowsHide: true });
    mark('compiled');
    const env = { POLYDESK_E2E_REMOTE_GATEWAY: '' };
    const configureFixture = async (application: ElectronApplication): Promise<void> => {
      const identity = await application.evaluate(({ app }) => ({ userData: app.getPath('userData'), packaged: app.isPackaged }));
      expect(resolve(identity.userData)).toBe(resolve(userData));
      expect(identity.packaged).toBe(false);
      // The launch override did not survive startup in this environment. Set only
      // this isolated, verified test process after startup; CLI execution stays real.
      const actual = await application.evaluate(({}, fixtureProgramFiles: string) => {
        process.env.ProgramFiles = fixtureProgramFiles;
        return process.env.ProgramFiles;
      }, programFiles);
      expect(actual).toBe(programFiles);
    };
    let launched = await launchApp({ userData, env }); app = launched.app;
    await configureFixture(app);
    page = launched.page;
    await page.getByRole('button', { name: '設定', exact: true }).click();
    let section = page.locator('section[aria-label="手機遠端啟動"]');
    await section.getByRole('button', { name: '啟用手機遠端啟動', exact: true }).click();
    mark('enableClicked');
    // Native CLI cold start runs several sequential processes, each bounded by
    // the gateway's 10-second timeout. First wait for the UI operation to finish.
    await expect(section.getByRole('button', { name: /^(啟用|停用)手機遠端啟動$/ })).toBeEnabled({ timeout: 90000 });
    mark('enableFinished');
    await expect(section.getByRole('status')).toContainText('已啟用 · 僅 Tailscale 私人 HTTPS');
    expect(await page.evaluate(() => window.polydesk.remote.status()).then(status => status.url)).toBe('https://recovery.test.ts.net:8443');
    expect(existsSync(join(bin, 'mapping'))).toBe(true);
    expect(readFileSync(join(bin, 'commands.log'), 'utf8')).toContain('status --json');
    expect(readFileSync(join(bin, 'commands.log'), 'utf8')).toContain('serve status --json');
    const initial = await sessionStatus();
    expect(initial.status).toBe(200);
    expect(JSON.parse(initial.body).paired).toBe(false);
    await section.getByRole('status').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('remote-before.png') });

    writeFileSync(join(bin, 'mode'), 'fail');
    mark('failureInjected');
    await expect(section.getByRole('status')).toContainText('暫停受理', { timeout: 18000 });
    await expect(section.getByRole('status')).toContainText('1/3');
    const paused = await sessionStatus();
    expect(paused.status).toBe(503);
    expect(JSON.parse(paused.body).error).toContain('暫停受理');
    await section.getByRole('status').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('remote-paused.png') });

    writeFileSync(join(bin, 'mode'), 'healthy');
    mark('recoveryInjected');
    await expect(section.getByRole('status')).toHaveText('已啟用 · 僅 Tailscale 私人 HTTPS', { timeout: 18000 });
    const recovered = await sessionStatus();
    expect(recovered.status).toBe(200);
    expect(JSON.parse(recovered.body).paired).toBe(false);
    await section.getByRole('status').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('remote-recovered.png') });

    writeFileSync(join(bin, 'mode'), 'funnel');
    mark('funnelInjected');
    await expect(section.getByRole('status')).toContainText('已停用 · 無遠端監聽', { timeout: 18000 });
    await expect(section.getByRole('status')).toContainText('Funnel');
    await expect(section.getByRole('button', { name: '啟用手機遠端啟動', exact: true })).toBeEnabled({ timeout: 90000 });
    mark('disabled');
    await section.getByText('近期操作紀錄', { exact: true }).click();
    await expect(section.locator('details')).toContainText('Funnel 公開入口');
    await expect(section.locator('details')).toContainText('私人連線已恢復');
    await section.getByRole('status').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('remote-disabled.png') });
    await expect.poll(() => existsSync(join(bin, 'mapping')), { timeout: 90000 }).toBe(false);
    const commands = readFileSync(join(bin, 'commands.log'), 'utf8');
    expect(commands).toContain('serve --bg --https=8443 http://127.0.0.1:49387');
    expect(commands).toContain('serve --https=8443 off');
    await app.close(); app = undefined;

    launched = await launchApp({ userData, env }); app = launched.app; page = launched.page;
    await configureFixture(app);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    section = page.locator('section[aria-label="手機遠端啟動"]');
    await expect(section.getByRole('status')).toContainText('已停用 · 無遠端監聽');
    await section.getByText('近期操作紀錄', { exact: true }).click();
    await expect(section.locator('details')).toContainText('Funnel 公開入口');
    await expect(section.locator('details')).toContainText('私人連線已恢復');
    await section.getByRole('status').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('remote-disabled-after-restart.png') });
    await section.locator('details').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('remote-audit-after-restart.png') });
  } catch (error) {
    mark('failed');
    const probes = await Promise.allSettled([
      page?.locator('section[aria-label="手機遠端啟動"]').getByRole('status').textContent({ timeout: 3000 }),
      page?.locator('section[aria-label="手機遠端啟動"]').getByRole('alert').allTextContents(),
      page?.evaluate(() => window.polydesk.remote.status()),
      app?.evaluate(() => process.env.ProgramFiles),
      page?.screenshot({ path: testInfo.outputPath('remote-recovery-failure.png') }),
    ]);
    const values = probes.slice(0, 4).map(probe => probe.status === 'fulfilled' ? probe.value : { unavailable: String(probe.reason) });
    writeFileSync(testInfo.outputPath('remote-recovery-failure.json'), JSON.stringify({
      timestamps, uiStatus: values[0], uiAlerts: values[1], remoteStatus: values[2], programFiles: values[3],
      fixtureMapping: existsSync(join(bin, 'mapping')),
      fixtureCommands: existsSync(join(bin, 'commands.log')) ? readFileSync(join(bin, 'commands.log'), 'utf8') : '',
    }, null, 2), 'utf8');
    throw error;
  } finally {
    try { await app?.close(); } finally {
      const cleanupRoot = resolve(root);
      if (dirname(cleanupRoot).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !basename(cleanupRoot).startsWith('pd-remote-recovery-')) {
        throw new Error(`Refusing unexpected recovery fixture cleanup path: ${cleanupRoot}`);
      }
      rmSync(cleanupRoot, { recursive: true, force: true });
    }
  }
});
