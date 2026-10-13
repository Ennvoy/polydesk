'use strict';
// Isolated diagnostic only: existing build, real Electron/UI/IPC/Git, no response mocks.
const { createRequire } = require('node:module');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = 'C:/polydesk-remote-dev';
const { _electron: electron, expect: baseExpect } = createRequire(join(repo, 'package.json'))('@playwright/test');
const expect = baseExpect.configure({ timeout: 15000 });
const fixture = mkdtempSync(join(tmpdir(), 'pd-cleanup-busy-diagnostic-'));
const work = join(fixture, 'work'); const remote = join(fixture, 'upstream.git');
const userData = join(fixture, 'user-data');
const qa = join(repo, '.constellation', 'qa', 'remote-launch');
mkdirSync(qa, { recursive: true });
const output = join(qa, 'cleanup-busy-isolated-diagnostic.txt');
const report = join(qa, 'cleanup-busy-isolated-diagnostic.json');
writeFileSync(output, 'Isolated real Electron/UI/IPC/Git diagnostic; no response mocks\n', 'utf8');
const log = value => { const line = typeof value === 'string' ? value : JSON.stringify(value); appendFileSync(output, line + '\n', 'utf8'); console.log(line); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000 });
let app, page, timer, observationBusy = false, failure, finalState;
const observations = [];
const stageTimes = {};
async function stage(name, fn) {
  const started = Date.now();
  try { return await fn(); } finally { stageTimes[name] = Date.now() - started; log({ stage: name, durationMs: stageTimes[name] }); }
}
async function readState() {
  const main = await app.evaluate(() => {
    const d = globalThis.__pdCleanupDiagnostic;
    const status = d.ipc.filter(c => c.channel === 'git:cleanupStatus');
    return {
      at: Date.now(), statusRequested: status.length, statusCompleted: status.filter(c => c.finishedAt).length,
      statusOutstanding: status.filter(c => !c.finishedAt).length,
      execute: d.ipc.filter(c => c.channel === 'git:cleanupExecute'),
      activeGit: d.git.filter(c => !c.finishedAt),
      commonDirCalls: d.git.filter(c => c.args.includes('--git-common-dir')).length,
      lastFinishedGit: d.git.filter(c => c.finishedAt).slice(-5),
    };
  });
  const renderer = await page.evaluate(() => {
    const refresh = document.querySelector('button[aria-label="重新整理"]');
    const feedback = document.querySelector('[data-testid="cleanup-feedback"]');
    return {
      refreshDisabled: refresh?.disabled,
      feedbackKind: feedback?.getAttribute('data-kind'), feedback: feedback?.textContent,
      busyText: document.querySelector('.pd-scm-busy')?.textContent,
    };
  });
  return { ...main, renderer };
}
(async () => {
  try {
    await stage('fixture', async () => {
      mkdirSync(work); mkdirSync(userData);
      git(work, 'init', '-b', 'main'); git(work, 'config', 'user.email', 'diagnostic@test'); git(work, 'config', 'user.name', 'Diagnostic');
      writeFileSync(join(work, 'base.txt'), 'base\n', 'utf8'); git(work, 'add', '.'); git(work, 'commit', '-m', 'seed');
      git(work, 'branch', 'remote-delete'); git(fixture, 'init', '--bare', remote);
      git(work, 'remote', 'add', 'team/backend', remote); git(work, 'push', '-u', 'team/backend', 'main'); git(work, 'push', 'team/backend', 'remote-delete');
      writeFileSync(join(userData, 'state.json'), JSON.stringify({ schemaVersion: 3, onboarding: { version: 2, status: 'completed', step: 0 } }), 'utf8');
    });
    app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, POLYDESK_USER_DATA: userData } });
    const deadline = Date.now() + 12000;
    while (!page && Date.now() < deadline) {
      page = app.windows().find(w => !w.url().startsWith('data:') && (w.url().includes('/renderer/index.html') || w.url().includes('localhost')));
      if (!page) await new Promise(r => setTimeout(r, 25));
    }
    if (!page) throw new Error('Renderer did not open');
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ ipcMain, dialog }, folder) => {
      globalThis.__pdCleanupDiagnostic = { ipc: [], git: [] };
      const d = globalThis.__pdCleanupDiagnostic;
      const cp = process.getBuiltinModule('node:child_process');
      const originalExecFile = cp.execFile;
      cp.execFile = function(...args) {
        const callback = args.at(-1);
        if (args[0] !== 'git' || typeof callback !== 'function') return originalExecFile.apply(this, args);
        const c = { startedAt: Date.now(), args: [...args[1]] };
        d.git.push(c);
        args[args.length - 1] = function(error, stdout, stderr) {
          c.finishedAt = Date.now(); c.durationMs = c.finishedAt - c.startedAt;
          c.code = error ? error.code : 0;
          return callback(error, stdout, stderr);
        };
        return originalExecFile.apply(this, args);
      };
      const handlers = ipcMain._invokeHandlers;
      if (!(handlers instanceof Map)) throw new Error('Cannot observe existing IPC handlers');
      for (const channel of ['git:cleanupStatus', 'git:cleanupPreview', 'git:cleanupExecute', 'git:snapshot', 'git:branch', 'git:status']) {
        const original = handlers.get(channel);
        if (!original) throw new Error('Missing existing handler ' + channel);
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (...args) => {
          const c = { channel, requestedAt: Date.now(), branch: args[1]?.branch };
          d.ipc.push(c);
          try {
            const result = await original(...args);
            c.result = { ok: result?.ok, phase: result?.phase, journals: result?.journals?.map(j => ({ phase: j.phase, checkpoints: j.checkpoints })) };
            return result;
          } finally { c.finishedAt = Date.now(); c.durationMs = c.finishedAt - c.requestedAt; }
        });
      }
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, work);
    timer = setInterval(() => {
      if (observationBusy) return;
      observationBusy = true;
      void readState().then(s => { observations.push(s); log(s); }).catch(e => log('Observation error: ' + e)).finally(() => { observationBusy = false; });
    }, 10000);
    await stage('workspace', async () => {
      await page.locator('button[aria-label="新增工作區"]').first().click();
      await page.locator('button[aria-label="信任並新增工作區"]').click();
      await page.locator('button[aria-label="原始碼控制"]').click();
      await page.getByRole('tab', { name: '分支' }).click();
      await expect(page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' })).toBeEnabled({ timeout: 120000 });
    });
    await stage('preview', async () => {
      await page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' }).click();
      await page.getByRole('menuitem', { name: '刪除遠端分支', exact: true }).click();
      await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60000 });
    });
    await stage('execute-until-remote-deleted', async () => {
      await page.getByRole('button', { name: '開始完整清理' }).click();
      await expect.poll(() => git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/remote-delete').trim(), { timeout: 120000 }).toBe('');
    });
    log({ event: 'remote-ref-deleted', state: await readState() });
    await stage('completion-until-refresh-enabled', async () => {
      await expect(page.getByRole('button', { name: '重新整理' })).toBeEnabled({ timeout: 120000 });
    });
    log({ event: 'refresh-enabled', state: await readState() });
  } catch (error) {
    failure = error; log(error.stack || String(error));
  } finally {
    if (timer) clearInterval(timer);
    if (app) {
      try { finalState = await app.evaluate(() => globalThis.__pdCleanupDiagnostic); } catch (error) { log('Final trace error: ' + error); }
      try { await app.close(); } catch (error) { failure ??= error; log('App cleanup error: ' + error); }
    }
    const owned = resolve(fixture);
    if (dirname(owned).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !owned.split(/[\\/]/).pop().startsWith('pd-cleanup-busy-diagnostic-')) {
      failure ??= new Error('Refusing cleanup outside owned TEMP fixture');
    } else {
      try { rmSync(owned, { recursive: true, force: true }); } catch (error) { failure ??= error; }
    }
    const evidence = { status: failure ? 'FAIL' : 'PASS', diagnosticOnly: true, noResponseMocks: true, stageTimes, observations, finalState, error: failure ? String(failure) : undefined };
    writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    log({ evidence: report, status: evidence.status, ownedAppClosed: true });
    if (failure) process.exitCode = 1;
  }
})();
