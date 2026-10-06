import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}
function configure(repo: string): void {
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'user.email', 'e2e@test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'pull.rebase', 'false');
}
function commit(repo: string, subject: string): void { git(repo, 'add', '.'); git(repo, 'commit', '-m', subject); }
function seed(): { root: string; repo: string; other: string } {
  const root = mkdtempSync(join(tmpdir(), 'pd-git-errors-'));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'work');
  const other = join(root, 'other');
  mkdirSync(repo);
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(repo, 'init', '-b', 'main');
  configure(repo);
  writeFileSync(join(repo, 'app.txt'), 'base\n');
  commit(repo, 'base');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  git(root, 'clone', remote, other);
  configure(other);
  return { root, repo, other };
}

test('拉取覆蓋防護：tracked 與 untracked 原檔保留，長診斷預設折疊且刷新不清錯誤', async ({}, testInfo) => {
  const { root, repo, other } = seed();
  const longFile = 'long-name-for-untracked-overwrite-regression-file.txt';
  writeFileSync(join(other, 'app.txt'), 'remote\n');
  writeFileSync(join(other, longFile), 'remote new\n');
  commit(other, 'remote overwrite candidates');
  git(other, 'push');
  writeFileSync(join(repo, 'app.txt'), 'local unsaved\n');
  writeFileSync(join(repo, longFile), 'local new\n');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]);
    await addWorkspaceViaUI(page);
    await page.getByLabel('原始碼控制', { exact: true }).click();
    await expect(page.locator('.pd-scm-behind')).toHaveText('↓1 未拉取');
    const before = git(repo, 'rev-parse', 'HEAD');
    await page.getByLabel('拉取（pull）：1 個 commit 未拉取', { exact: true }).click();
    const alert = page.locator('.pd-scm-error[role="alert"]');
    await expect(alert).toContainText('本機檔案會被覆蓋');
    await expect(alert.locator('details')).not.toHaveAttribute('open');
    expect(readFileSync(join(repo, 'app.txt'), 'utf8')).toBe('local unsaved\n');
    expect(readFileSync(join(repo, longFile), 'utf8')).toBe('local new\n');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'stash', 'list').trim()).toBe('');
    await page.getByLabel('重新整理', { exact: true }).click();
    await expect(page.getByLabel('重新整理', { exact: true })).toBeVisible();
    await expect(alert).toContainText('本機檔案會被覆蓋');
    await page.screenshot({ path: testInfo.outputPath('git-overwrite-folded.png') });
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});

test('pull 真合併衝突：失敗後立即列出 U，保留 MERGE_HEAD 與診斷', async () => {
  const { root, repo, other } = seed();
  writeFileSync(join(repo, 'app.txt'), 'local commit\n');
  commit(repo, 'local change');
  writeFileSync(join(other, 'app.txt'), 'remote commit\n');
  commit(other, 'remote change');
  git(other, 'push');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]); await addWorkspaceViaUI(page);
    await page.getByLabel('原始碼控制', { exact: true }).click();
    await expect(page.locator('.pd-scm-behind')).toHaveText('↓1 未拉取');
    await page.getByLabel('拉取（pull）：1 個 commit 未拉取', { exact: true }).click();
    await expect(page.locator('.pd-scm-error[role="alert"]')).toContainText('檔案有合併衝突');
    await expect(page.locator('.pd-scm-change', { hasText: 'app.txt' })).toContainText('U');
    expect(git(repo, 'status', '--porcelain')).toContain('UU app.txt');
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});

test('stash pop 真衝突：失敗後顯示 U 並保留原 stash', async () => {
  const { root, repo } = seed();
  writeFileSync(join(repo, 'app.txt'), 'stashed change\n');
  git(repo, 'stash', 'push');
  const stash = git(repo, 'rev-parse', 'refs/stash');
  writeFileSync(join(repo, 'app.txt'), 'new committed change\n');
  commit(repo, 'new committed change');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]); await addWorkspaceViaUI(page);
    await page.getByLabel('原始碼控制', { exact: true }).click();
    await expect(page.locator('.pd-scm-branch')).toContainText('main');
    await page.getByLabel('還原暫存（stash pop）', { exact: true }).click();
    await expect(page.locator('.pd-scm-error[role="alert"]')).toContainText('原 stash 會保留');
    await expect(page.locator('.pd-scm-change', { hasText: 'app.txt' })).toContainText('U');
    expect(git(repo, 'status', '--porcelain')).toContain('UU app.txt');
    expect(git(repo, 'rev-parse', 'refs/stash')).toBe(stash);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});

test('外部 stage 只修改 Git 索引、變更筆數相同，SCM 仍更新暫存狀態', async () => {
  const { root, repo } = seed();
  writeFileSync(join(repo, 'app.txt'), 'outside staged content\n');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]); await addWorkspaceViaUI(page);
    await page.getByLabel('原始碼控制', { exact: true }).click();
    await expect(page.getByLabel('暫存：app.txt', { exact: true })).toBeVisible();
    git(repo, 'add', 'app.txt');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByLabel('取消暫存：app.txt', { exact: true })).toBeVisible();
    await expect(page.getByLabel('暫存：app.txt', { exact: true })).toHaveCount(0);
    expect(git(repo, 'status', '--porcelain')).toBe('M  app.txt\n');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});

test('worktree 分支載入遇到真 Git 錯誤時結束 loading，顯示重新開啟的處理方式', async () => {
  const { root, repo } = seed();
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]); await addWorkspaceViaUI(page);
    // 實體 repository metadata 暫時不可用，Git 原 handler 必須真的失敗。
    renameSync(join(repo, '.git'), join(repo, '.git-held'));
    await page.getByLabel('新增', { exact: true }).click();
    await page.getByLabel('從 Git 分支建立 worktree', { exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '請取消後重新開啟建立視窗' })).toBeVisible();
    await page.getByRole('radio', { name: '現有本地分支', exact: true }).check();
    await expect(page.getByRole('combobox', { name: '現有本地分支', exact: true })).toBeEnabled();
    await expect(page.getByLabel('建立並開啟工作區', { exact: true })).toBeDisabled();
    await page.getByLabel('取消建立 worktree', { exact: true }).click();
    expect(git(root, '--git-dir', join(repo, '.git-held'), 'rev-parse', '--verify', 'HEAD').trim()).not.toBe('');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});

test('worktree 遠端名稱含斜線：正確建立 topic 本地分支並追蹤完整遠端身分', async () => {
  const { root, repo, other } = seed();
  git(other, 'checkout', '-b', 'topic');
  writeFileSync(join(other, 'topic.txt'), 'topic content\n');
  commit(other, 'topic commit'); git(other, 'push', 'origin', 'topic');
  git(repo, 'remote', 'rename', 'origin', 'team/upstream'); git(repo, 'fetch', 'team/upstream');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]); await addWorkspaceViaUI(page);
    await page.getByLabel('新增', { exact: true }).click();
    await page.getByLabel('從 Git 分支建立 worktree', { exact: true }).click();
    await page.getByRole('radio', { name: 'remote 分支', exact: true }).check();
    await page.getByRole('combobox', { name: 'remote 分支', exact: true }).selectOption('team/upstream/topic');
    await expect(page.getByLabel('worktree 建立位置', { exact: true })).toHaveValue(/[\\/]topic$/);
    const target = await page.getByLabel('worktree 建立位置', { exact: true }).inputValue();
    expect(target).toMatch(/[\\/]topic$/);
    await page.getByLabel('建立並開啟工作區', { exact: true }).click();
    await expect.poll(() => git(repo, 'worktree', 'list').includes('[topic]')).toBe(true);
    expect(git(target, 'branch', '--show-current').trim()).toBe('topic');
    expect(git(target, 'config', 'branch.topic.remote').trim()).toBe('team/upstream');
    expect(git(target, 'config', 'branch.topic.merge').trim()).toBe('refs/heads/topic');
    expect(readFileSync(join(target, 'topic.txt'), 'utf8')).toBe('topic content\n');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});

test('切換工作區：A 真 Git 歷史延遲回包不污染 B，提交草稿各自保留', async () => {
  const { root, repo } = seed();
  const repoB = join(root, 'second');
  mkdirSync(repoB); git(repoB, 'init', '-b', 'branch-b'); configure(repoB);
  writeFileSync(join(repoB, 'b.txt'), 'base b\n'); commit(repoB, 'B history');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo, repoB]); await addWorkspaceViaUI(page); await addWorkspaceViaUI(page);
    await page.getByLabel('開啟工作區 work', { exact: true }).click();
    await page.getByLabel('原始碼控制', { exact: true }).click();
    await expect(page.locator('.pd-scm-branch')).toContainText('main');
    await page.getByLabel('commit 訊息', { exact: true }).fill('A draft');
    // 控制真 handler 的回包時序；Git 原本的 log 讀取完整執行。
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, request: unknown) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('git:log');
      if (!original) throw new Error('git:log handler missing');
      const state = globalThis as typeof globalThis & { pdGitDelay?: { started: boolean; release?: () => void } };
      state.pdGitDelay = { started: false };
      ipcMain.removeHandler('git:log');
      ipcMain.handle('git:log', async (event, request: unknown) => {
        const result = await original(event, request);
        if (!state.pdGitDelay?.started) {
          state.pdGitDelay = { started: true };
          await new Promise<void>((resolve) => { if (state.pdGitDelay) state.pdGitDelay.release = resolve; });
        }
        return result;
      });
    });
    await page.getByRole('tab', { name: '歷史', exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { pdGitDelay?: { started: boolean } }).pdGitDelay?.started)).toBe(true);
    await page.getByLabel('開啟工作區 second', { exact: true }).click();
    await expect(page.locator('.pd-scm-branch')).toContainText('branch-b');
    await expect(page.getByLabel('commit 訊息', { exact: true })).toHaveValue('');
    await page.getByLabel('commit 訊息', { exact: true }).fill('B draft');
    await page.getByRole('tab', { name: '歷史', exact: true }).click();
    await expect(page.locator('.pd-scm-logrow')).toContainText('B history');
    await app.evaluate(() => (globalThis as typeof globalThis & { pdGitDelay?: { release?: () => void } }).pdGitDelay?.release?.());
    await page.waitForTimeout(150); // 讓已放行的 A IPC 回包抵達 renderer，才檢查沒有覆蓋 B。
    await expect(page.locator('.pd-scm-logrow')).toContainText('B history');
    await expect(page.locator('.pd-scm-logrow', { hasText: 'base' })).toHaveCount(0);
    await page.getByLabel('開啟工作區 work', { exact: true }).click();
    await expect(page.getByLabel('commit 訊息', { exact: true })).toHaveValue('A draft');
    await page.getByLabel('開啟工作區 second', { exact: true }).click();
    await expect(page.getByLabel('commit 訊息', { exact: true })).toHaveValue('B draft');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); }
});

test('SCM 初次狀態掃描未完成時可讀歷史、分支與 worktree', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'pd-scm-metadata-'));
  const repo = join(root, 'work');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, '-c', 'user.name=E2E', '-c', 'user.email=e2e@test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'base');
  console.log('SCM metadata test: fixture ready');
  const { app, page, userData } = await launchApp();
  console.log('SCM metadata test: Electron ready');
  try {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, request: unknown) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('git:snapshot');
      if (!original) throw new Error('git:snapshot handler missing');
      const state = globalThis as typeof globalThis & { pdSlowSnapshot?: { started: boolean; release?: () => void } };
      state.pdSlowSnapshot = { started: false };
      ipcMain.removeHandler('git:snapshot');
      ipcMain.handle('git:snapshot', async (event, request: unknown) => {
        const result = await original(event, request); // 真 Git 掃描已完成，只延後回 renderer。
        if (!state.pdSlowSnapshot?.started) {
          state.pdSlowSnapshot = { started: true };
          await new Promise<void>((resolve) => { if (state.pdSlowSnapshot) state.pdSlowSnapshot.release = resolve; });
        }
        return result;
      });
    });
    await stubFolderPicker(app, [repo]);
    await addWorkspaceViaUI(page);
    console.log('SCM metadata test: workspace ready');
    await page.getByLabel('原始碼控制', { exact: true }).click();
    await expect(page.getByRole('tab', { name: '歷史', exact: true })).toBeVisible();
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { pdSlowSnapshot?: { started: boolean } }).pdSlowSnapshot?.started).catch(() => false), { timeout: 30_000 }).toBe(true);
    console.log('SCM metadata test: snapshot gated');
    await page.getByRole('tab', { name: '歷史', exact: true }).click();
    await expect(page.locator('.pd-scm-logrow')).toContainText('base');
    console.log('SCM metadata test: history ready');
    await page.getByRole('tab', { name: '分支', exact: true }).click();
    await expect(page.locator('.pd-scm-branchrow', { hasText: 'main' }).first()).toBeVisible();
    console.log('SCM metadata test: branches ready');
    await page.getByRole('tab', { name: 'worktree', exact: true }).click();
    await expect(page.locator('.pd-scm-branchrow', { hasText: 'main' }).first()).toBeVisible();
    console.log('SCM metadata test: worktrees ready');
    await page.screenshot({ path: testInfo.outputPath('scm-metadata-before-status.png') });
    await app.evaluate(() => (globalThis as typeof globalThis & { pdSlowSnapshot?: { release?: () => void } }).pdSlowSnapshot?.release?.());
    await expect(page.locator('.pd-scm-branch')).toContainText('main');
  } finally {
    await app.evaluate(() => (globalThis as typeof globalThis & { pdSlowSnapshot?: { release?: () => void } }).pdSlowSnapshot?.release?.()).catch(() => undefined);
    await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true });
  }
});
