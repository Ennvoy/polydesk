const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createServer, createConnection } = require('node:net');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const projectRequire = createRequire('C:/polydesk-remote-dev/package.json');
const { chromium } = projectRequire('playwright');
const asar = projectRequire('@electron/asar');
const exe = 'C:/polydesk-dist/Polydesk-0.40.0-portable.exe';
const qa = 'C:/Users/ennvoy.lin/Documents/polydesk-dist/qa-v0.40.0';
const root = mkdtempSync(join(tmpdir(), 'pd-portable-040-'));
const extractTemp = join(root, 'Temp');
const userData = join(root, 'userData');
const missingPrerequisite = join(root, 'program-files');
mkdirSync(extractTemp); mkdirSync(userData); mkdirSync(missingPrerequisite); mkdirSync(qa, { recursive: true });
writeFileSync(join(userData, 'state.json'), JSON.stringify({
  schemaVersion: 3, onboarding: { version: 2, status: 'completed', step: 0 },
}), 'utf8');
const evidence = { exe, root, startedAt: new Date().toISOString(), checks: {}, error: null };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function markers(path) {
  if (!existsSync(path)) return [];
  const found = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...markers(child));
    else if (entry.name === '.polydesk-startup-ready') found.push(child);
  }
  return found;
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function hasListener(port) {
  return await new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const end = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => end(true)); socket.once('error', () => end(false));
    socket.setTimeout(1000, () => end(false));
  });
}
(async () => {
  let browser; let child; let exit;
  try {
    assert(existsSync(exe), 'portable must exist');
    const port = await freePort();
    const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'programfiles'));
    child = spawn(exe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
      windowsHide: true, stdio: 'ignore',
      env: { ...inheritedEnv, ProgramFiles: missingPrerequisite, TEMP: extractTemp, TMP: extractTemp, POLYDESK_USER_DATA: userData, POLYDESK_E2E_REMOTE_GATEWAY: '1' },
    });
    evidence.wrapperPid = child.pid;
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    let connectionError;
    const connectionDeadline = Date.now() + 240000;
    while (Date.now() < connectionDeadline && !browser) {
      if (exit) throw new Error(`portable exited before ready: ${JSON.stringify(exit)}`);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 }); }
      catch (error) { connectionError = error; await pause(500); }
    }
    if (!browser) throw connectionError;
    let page;
    const rendererDeadline = Date.now() + 60000;
    while (Date.now() < rendererDeadline && !page) {
      page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('/renderer/index.html'));
      if (!page) await pause(250);
    }
    assert(page, 'interactive main page must load');
    await page.waitForLoadState('domcontentloaded');
    const skip = page.getByRole('button', { name: '略過導覽', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByRole('button', { name: '設定', exact: true }).click({ timeout: 20000 });
    const section = page.locator('section[aria-label="手機遠端啟動"]');
    await section.waitFor({ state: 'visible', timeout: 15000 });
    const status = await page.evaluate(() => window.polydesk.remote.status());
    assert.equal(status.enabled, false); assert.equal(status.url, null);
    assert.equal(status.devices.length, 0); assert.equal(status.pending.length, 0);
    evidence.checks.defaultOff = true;
    evidence.checks.rendererIsolation = await page.evaluate(() => ({ require: typeof window.require, process: typeof process }));
    assert.equal(evidence.checks.rendererIsolation.require, 'undefined');
    assert.equal(evidence.checks.rendererIsolation.process, 'undefined');
    await section.getByRole('button', { name: '啟用手機遠端啟動', exact: true }).click();
    await section.getByRole('alert').waitFor({ state: 'visible', timeout: 20000 });
    const message = await section.getByRole('alert').innerText();
    assert.match(message, /Tailscale/); assert.doesNotMatch(message, /poly\.test/);
    const after = await page.evaluate(() => window.polydesk.remote.status());
    assert.equal(after.enabled, false); assert.equal(after.url, null);
    assert.equal(await hasListener(49387), false);
    evidence.checks.packagedIgnoresTestGateway = true;
    evidence.checks.missingPrerequisiteFixture = 'isolated empty ProgramFiles; no actual Tailscale configuration changed';
    evidence.checks.missingTailscaleFailsClosed = message;
    evidence.checks.noRemoteListenerAfterFailure = true;
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(qa, 'portable-remote-default-off.png') });
    const marker = markers(extractTemp)[0];
    assert(marker, 'portable ready handoff marker must exist');
    evidence.marker = marker;
    const appPath = marker.slice(0, marker.lastIndexOf('\\'));
    const archive = join(appPath, 'resources', 'app.asar');
    const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
    assert.equal(pkg.version, '0.40.0'); assert.equal(pkg.dependencies.qrcode, '1.5.4');
    evidence.checks.version = pkg.version;
    assert(asar.listPackage(archive).some(path => path.replaceAll('\\', '/').endsWith('/node_modules/qrcode/lib/index.js')));
    evidence.checks.qrcodeBundled = true;
    assert(existsSync(join(appPath, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty')));
    evidence.checks.nativePtyBundled = true;
    await browser.close(); browser = undefined;
    evidence.nativeClose = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/ennvoy.lin/AppData/Local/Temp/polydesk-v040-native-close.ps1', '-OwnedAppDirectory', appPath], { windowsHide: true, encoding: 'utf8' }));
    evidence.closeRequested = true;
    for (let i = 0; i < 180 && !exit; i++) await pause(250);
    assert(exit, 'portable wrapper should finish'); assert.equal(exit.code, 0);
    evidence.wrapperExit = exit;
    evidence.unpackRemoved = !existsSync(appPath);
    assert(evidence.unpackRemoved, 'portable must clean its own extracted app');
  } catch (error) {
    evidence.error = error.stack || String(error);
    if (child && !exit) {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
      catch { }
    }
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(qa, 'portable-smoke-v040.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  }
})();
