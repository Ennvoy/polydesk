import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorkspaceViaUI, launchApp, stubFolderPicker } from './electronApp';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

test('真 Electron 歷史初載 20 筆，使用者每次捲到底追加 10 筆並保留切頁位置', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'pd-history-pagination-'));
  const repo = join(root, 'repo');
  const second = join(root, 'second');
  mkdirSync(repo);
  mkdirSync(second);
  git(repo, 'init', '-b', 'main');
  const chunks: string[] = [];
  for (let index = 1; index <= 60; index++) {
    const subject = `history-${String(index).padStart(3, '0')}`;
    const when = 1_700_000_000 + index;
    chunks.push(`commit refs/heads/main\nauthor E2E <e2e@test> ${when} +0000\ncommitter E2E <e2e@test> ${when} +0000\ndata ${subject.length}\n${subject}\nM 100644 inline history.txt\ndata ${subject.length}\n${subject}\n\n`);
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, input: chunks.join(''), stdio: 'pipe' });
  git(repo, 'reset', '--hard', 'main');
  git(second, 'init', '-b', 'main');
  git(second, '-c', 'user.name=E2E', '-c', 'user.email=e2e@test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'second-history');
  const expected = git(repo, 'log', '--all', '--topo-order', '--format=%s').trim().split('\n');
  const { app, page, userData } = await launchApp();
  try {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, request: unknown) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('git:logPage');
      if (!original) throw new Error('git:logPage handler missing');
      const snapshot = handlers.get('git:snapshot');
      if (!snapshot) throw new Error('git:snapshot handler missing');
      const state = globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[]; failOffset: number | null; gateOffset: number | null; gateStarted: boolean; release?: () => void } };
      state.pdHistoryPaging = { offsets: [], failOffset: null, gateOffset: null, gateStarted: false };
      const snapshotState = globalThis as typeof globalThis & { pdHistorySnapshot?: { started: boolean; release?: () => void } };
      snapshotState.pdHistorySnapshot = { started: false };
      ipcMain.removeHandler('git:snapshot');
      ipcMain.handle('git:snapshot', async (event, request: unknown) => {
        const result = await snapshot(event, request);
        if (!snapshotState.pdHistorySnapshot?.started) {
          snapshotState.pdHistorySnapshot = { started: true };
          await new Promise<void>((resolve) => { if (snapshotState.pdHistorySnapshot) snapshotState.pdHistorySnapshot.release = resolve; });
        }
        return result;
      });
      ipcMain.removeHandler('git:logPage');
      ipcMain.handle('git:logPage', async (event, request: unknown) => {
        const offset = (request as { offset: number }).offset;
        const result = await original(event, request); // 每次仍走真 Git 與真共用目錄讀取佇列。
        if (state.pdHistoryPaging) {
          state.pdHistoryPaging.offsets.push(offset);
          if (state.pdHistoryPaging.failOffset === offset) {
            state.pdHistoryPaging.failOffset = null;
            throw new Error('page read failed once');
          }
          if (state.pdHistoryPaging.gateOffset === offset) {
            state.pdHistoryPaging.gateOffset = null;
            state.pdHistoryPaging.gateStarted = true;
            await new Promise<void>((resolve) => { if (state.pdHistoryPaging) state.pdHistoryPaging.release = resolve; });
          }
        }
        return result;
      });
    });
    await stubFolderPicker(app, [repo, second]);
    await addWorkspaceViaUI(page);
    await page.getByLabel('開啟工作區 repo', { exact: true }).click();
    await page.getByLabel('原始碼控制', { exact: true }).click();
    await page.getByRole('tab', { name: '歷史', exact: true }).click();
    const rows = page.locator('.pd-scm-logrow');
    const subjects = page.locator('.pd-scm-logsubject');
    await expect(rows).toHaveCount(20, { timeout: 20_000 });
    await expect(subjects).toHaveText(expected.slice(0, 20));
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { pdHistorySnapshot?: { started: boolean } }).pdHistorySnapshot?.started)).toBe(true);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[] } }).pdHistoryPaging?.offsets)).toEqual([0]);
    await app.evaluate(() => (globalThis as typeof globalThis & { pdHistorySnapshot?: { release?: () => void } }).pdHistorySnapshot?.release?.());
    await expect(page.locator('.pd-scm-branch')).toContainText('main');
    await expect(rows).toHaveCount(20);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[] } }).pdHistoryPaging?.offsets)).toEqual([0]);
    await page.waitForTimeout(600); // 可捲動的首屏也不可自行預載第 21–30 筆。
    await expect(rows).toHaveCount(20);
    await page.screenshot({ path: testInfo.outputPath('history-20.png') });

    const body = page.locator('.pd-scm-body.pd-scroll');
    await app.evaluate(() => { const state = globalThis as typeof globalThis & { pdHistoryPaging?: { failOffset: number | null } }; if (state.pdHistoryPaging) state.pdHistoryPaging.failOffset = 20; });
    await body.hover();
    await page.mouse.wheel(0, 4000);
    await expect(body.getByRole('alert')).toContainText('page read failed once');
    await expect(rows).toHaveCount(20); // 追加失敗保留已讀頁與 cursor。
    await page.getByRole('button', { name: '重試載入', exact: true }).click();
    await expect(rows).toHaveCount(30, { timeout: 20_000 });
    await expect(subjects).toHaveText(expected.slice(0, 30));
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[] } }).pdHistoryPaging?.offsets)).toEqual([0, 20, 20]);
    await page.waitForTimeout(300);
    await expect(rows).toHaveCount(30); // 一次捲動最多追加一頁。

    await body.hover();
    await page.mouse.wheel(0, 4000);
    await expect(rows).toHaveCount(40, { timeout: 20_000 });
    await expect(subjects).toHaveText(expected.slice(0, 40));
    const scrollTop = await body.evaluate((element) => element.scrollTop);
    await page.getByRole('tab', { name: '分支', exact: true }).click();
    await page.getByRole('tab', { name: '歷史', exact: true }).click();
    await expect(rows).toHaveCount(40);
    expect(await body.evaluate((element) => element.scrollTop)).toBe(scrollTop);
    await page.screenshot({ path: testInfo.outputPath('history-40.png') });

    git(repo, 'tag', 'new-visible-ref', 'main');
    await page.getByRole('button', { name: '載入更多', exact: true }).click();
    await expect(rows).toHaveCount(20, { timeout: 20_000 });
    await expect(page.getByText('歷史已更新，顯示最新 20 筆。')).toBeVisible();
    for (const count of [30, 40, 50, 60]) {
      await page.getByRole('button', { name: '載入更多', exact: true }).click();
      await expect(rows).toHaveCount(count, { timeout: 20_000 });
      await expect(subjects).toHaveText(expected.slice(0, count));
    }
    await expect(page.getByText('已顯示全部提交。')).toBeVisible();
    const callsAtEnd = await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[] } }).pdHistoryPaging?.offsets.length);
    await body.hover();
    await page.mouse.wheel(0, 4000);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[] } }).pdHistoryPaging?.offsets.length)).toBe(callsAtEnd);
    await page.getByRole('button', { name: '重新整理', exact: true }).click();
    await expect(rows).toHaveCount(20, { timeout: 20_000 });

    await app.evaluate(() => { const state = globalThis as typeof globalThis & { pdHistoryPaging?: { gateOffset: number | null } }; if (state.pdHistoryPaging) state.pdHistoryPaging.gateOffset = 20; });
    await body.hover();
    await page.mouse.wheel(0, 4000);
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { gateStarted: boolean } }).pdHistoryPaging?.gateStarted)).toBe(true);
    const callsDuringGate = await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[] } }).pdHistoryPaging?.offsets.length);
    await page.mouse.wheel(0, 4000);
    await page.mouse.wheel(0, 4000);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { offsets: number[] } }).pdHistoryPaging?.offsets.length)).toBe(callsDuringGate);
    await addWorkspaceViaUI(page);
    await page.getByLabel('開啟工作區 second', { exact: true }).click();
    await page.getByRole('tab', { name: '歷史', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('second-history');
    await page.getByLabel('開啟工作區 repo', { exact: true }).click();
    await page.getByRole('tab', { name: '歷史', exact: true }).click();
    await expect(rows).toHaveCount(20);
    await expect(subjects).toHaveText(expected.slice(0, 20));
    await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { release?: () => void } }).pdHistoryPaging?.release?.());
    await expect(rows).toHaveCount(20); // A→B→A 舊追加不可混入新世代或解除其單飛鎖。
    await page.getByRole('button', { name: '載入更多', exact: true }).click();
    await expect(rows).toHaveCount(30);
    await expect(subjects).toHaveText(expected.slice(0, 30));
  } finally {
    await app.evaluate(() => (globalThis as typeof globalThis & { pdHistorySnapshot?: { release?: () => void } }).pdHistorySnapshot?.release?.()).catch(() => undefined);
    await app.evaluate(() => (globalThis as typeof globalThis & { pdHistoryPaging?: { release?: () => void } }).pdHistoryPaging?.release?.()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
