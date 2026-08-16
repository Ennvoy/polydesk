import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const shotDir = process.env.PD_SHOT_DIR || join(process.cwd(), 'test-results');
const cleanupTimeout = 120_000;

function seedRepo(): { root: string; repo: string; remote: string } {
  const root = mkdtempSync(join(tmpdir(), 'pd-branch-manage-'));
  const repo = join(root, 'work');
  const remote = join(root, 'upstream.git');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'branch@test');
  git(repo, 'config', 'user.name', 'Branch E2E');
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'initial');

  git(repo, 'branch', 'merged-local');
  git(repo, 'branch', 'remote-delete');
  git(repo, 'branch', 'profile');
  git(repo, 'branch', 'busy-worktree');
  git(repo, 'checkout', '-b', 'unfinished');
  writeFileSync(join(repo, 'unfinished.txt'), 'not merged\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'unfinished work');
  git(repo, 'checkout', 'main');
  git(repo, 'worktree', 'add', join(root, 'busy'), 'busy-worktree');

  git(root, 'init', '--bare', remote);
  git(repo, 'remote', 'add', 'team/backend', remote);
  git(repo, 'push', '-u', 'team/backend', 'main');
  git(repo, 'push', 'team/backend', 'remote-delete');
  git(repo, 'push', 'team/backend', 'profile:deployed-profile');
  git(repo, 'branch', '--set-upstream-to=team/backend/deployed-profile', 'profile');
  git(repo, 'config', 'branch.unfinished.description', 'must be removed with branch metadata');
  return { root, repo, remote };
}

async function openBranches(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.getByRole('tab', { name: '分支' }).click();
}

test('分支管理：本地／遠端分組與兩階段完整清理真鏈路', async () => {
  test.setTimeout(360_000);
  const { root, repo, remote } = seedRepo();
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]);
    await addWorkspaceViaUI(page);
    await openBranches(page);

    const localGroup = page.getByRole('button', { name: /^本地分支 \d+$/ });
    const remoteGroup = page.getByRole('button', { name: /^遠端分支 \d+$/ });
    await expect(localGroup).toHaveAttribute('aria-expanded', 'true');
    await expect(remoteGroup).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-branch-kind="local"]')).toHaveCount(6, { timeout: 30_000 });
    await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(3, { timeout: 30_000 });

    await remoteGroup.click();
    await expect(remoteGroup).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(0);
    await remoteGroup.click();
    await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(3);

    await page.getByRole('button', { name: '更多本地分支操作 profile' }).click();
    await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
    await page.getByLabel('連同檢查遠端同名／upstream 分支').check();
    await expect(page.getByRole('checkbox', { name: 'team/backend/deployed-profile' })).toBeChecked();
    await page.getByRole('button', { name: '檢查清理風險' }).click();
    await expect(page.getByRole('dialog')).toContainText('team/backend/deployed-profile', { timeout: 60_000 });
    await page.getByRole('button', { name: '開始完整清理' }).click();
    await expect(page.locator('[data-branch-kind="local"]', { hasText: 'profile' })).toHaveCount(0, { timeout: cleanupTimeout });
    expect(git(repo, 'branch', '--list', 'profile').trim()).toBe('');
    expect(git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/deployed-profile').trim()).toBe('');

    const mainMore = page.getByRole('button', { name: '更多本地分支操作 main' });
    await expect(mainMore).toBeEnabled({ timeout: cleanupTimeout });
    await mainMore.click();
    await expect(page.getByRole('menuitem', { name: '刪除本地分支（目前分支）' })).toBeEnabled();
    await page.screenshot({ path: join(shotDir, 'ui-branch-management-groups.png') });
    await page.keyboard.press('Escape');

    const busyRow = page.locator('[data-branch-kind="local"]', { hasText: 'busy-worktree' });
    await busyRow.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '刪除本地分支（由 worktree 使用中）' })).toBeEnabled();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '更多本地分支操作 merged-local' }).click();
    await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
    await expect(page.getByRole('heading', { name: '完整清理分支' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('此畫面尚未開始刪除');
    expect(git(repo, 'branch', '--list', 'merged-local').trim()).toBe('merged-local');
    await page.getByRole('button', { name: '檢查清理風險' }).click();
    await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Git 判定可安全刪除');
    await page.getByRole('button', { name: '開始完整清理' }).click();
    await expect(page.locator('[data-branch-kind="local"]', { hasText: 'merged-local' })).toHaveCount(0, { timeout: cleanupTimeout });
    expect(git(repo, 'branch', '--list', 'merged-local').trim()).toBe('');

    const remoteDeleteMore = page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' });
    await expect(remoteDeleteMore).toBeEnabled({ timeout: cleanupTimeout });
    await remoteDeleteMore.click();
    await page.getByRole('menuitem', { name: '刪除遠端分支', exact: true }).click();
    await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('dialog')).toContainText('team/backend/remote-delete');
    const deleteRemote = page.getByRole('button', { name: '開始完整清理' });
    await expect(deleteRemote).toHaveClass(/pd-btn-danger/);
    await deleteRemote.click();
    await expect.poll(() => git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/remote-delete').trim(), { timeout: cleanupTimeout }).toBe('');
    const refreshButton = page.getByRole('button', { name: '重新整理' });
    await expect(refreshButton).toBeEnabled({ timeout: cleanupTimeout });
    await refreshButton.click();
    await expect(page.locator('[data-branch-kind="remote"]', { hasText: 'team/backend/remote-delete' })).toHaveCount(0, { timeout: 30_000 });
    expect(git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/remote-delete').trim()).toBe('');
    expect(git(repo, 'branch', '--list', 'remote-delete').trim()).toBe('remote-delete');

    await page.getByRole('button', { name: '更多本地分支操作 unfinished' }).click();
    await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
    await page.getByRole('button', { name: '檢查清理風險' }).click();
    await expect(page.getByRole('dialog')).toContainText('尚未安全合併', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: '開始完整清理' })).toBeDisabled();
    await page.getByLabel('我確認強制清理本機未知／未合併內容').check();
    await expect(page.getByRole('button', { name: '開始完整清理' })).toBeEnabled();
    await page.getByRole('button', { name: '開始完整清理' }).click();
    await expect.poll(() => git(repo, 'branch', '--list', 'unfinished').trim(), { timeout: cleanupTimeout }).toBe('');
    await expect(refreshButton).toBeEnabled({ timeout: cleanupTimeout });
    await refreshButton.click();
    await expect(page.locator('[data-branch-kind="local"]', { hasText: 'unfinished' })).toHaveCount(0, { timeout: 30_000 });
    expect(git(repo, 'branch', '--list', 'unfinished').trim()).toBe('');
    expect(() => git(repo, 'config', '--get-regexp', '^branch\\.unfinished\\.')).toThrow();
    expect(() => git(repo, 'reflog', 'exists', 'refs/heads/unfinished')).toThrow();
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('遠端多 endpoint 部分失敗後，重啟仍顯示待辦並可繼續收斂', async () => {
  test.setTimeout(360_000);
  const { root, repo, remote } = seedRepo();
  const rejectingRemote = join(root, 'rejecting.git');
  mkdirSync(rejectingRemote, { recursive: true });
  git(rejectingRemote, 'init', '--bare');
  git(repo, 'push', rejectingRemote, 'remote-delete:refs/heads/remote-delete');
  git(repo, 'config', '--add', 'remote.team/backend.pushurl', remote);
  git(repo, 'config', '--add', 'remote.team/backend.pushurl', rejectingRemote);
  git(rejectingRemote, 'config', 'receive.denyDeletes', 'true');

  const first = await launchApp();
  let app = first.app;
  let page = first.page;
  const { userData } = first;
  try {
    await stubFolderPicker(app, [repo]);
    await addWorkspaceViaUI(page);
    await openBranches(page);

    await page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' }).click();
    await page.getByRole('menuitem', { name: '刪除遠端分支', exact: true }).click();
    await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('dialog').locator('.pd-cleanup-remotes .pd-cleanup-card')).toHaveCount(2);
    await page.getByRole('button', { name: '開始完整清理' }).click();

    await expect(page.locator('.pd-scm-error')).toContainText('遠端清理只有部分完成', { timeout: cleanupTimeout });
    await expect(page.locator('.pd-scm-error-detail')).not.toHaveAttribute('open');
    await expect(page.locator('.pd-scm-error-detail summary')).toHaveText('顯示技術細節');
    const recoveryTodo = page.getByTestId('cleanup-recovery-todo');
    await expect(recoveryTodo).toContainText('remote-delete', { timeout: cleanupTimeout });
    const recoveryMetrics = await recoveryTodo.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(recoveryMetrics.scrollWidth).toBeLessThanOrEqual(recoveryMetrics.clientWidth + 1);
    const resumeBox = await recoveryTodo.getByRole('button', { name: '繼續收斂' }).boundingBox();
    expect(resumeBox?.width ?? 0).toBeGreaterThanOrEqual(110);
    await page.screenshot({ path: join(shotDir, 'ui-cleanup-recovery-responsive.png') });
    expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/remote-delete').trim()).toBe('');
    expect(git(rejectingRemote, 'for-each-ref', '--format=%(refname)', 'refs/heads/remote-delete').trim()).toBe(
      'refs/heads/remote-delete',
    );

    await app.close();
    const activeDir = join(userData, 'branch-cleanup', 'active');
    const payloadFile = readdirSync(activeDir).find((file) => file.endsWith('.payload.json'));
    if (!payloadFile) throw new Error('expected active cleanup payload');
    const evidenceJson = readFileSync(join(activeDir, payloadFile), 'utf8');
    writeFileSync(join(activeDir, payloadFile), '{"tampered":true}', 'utf8');
    git(rejectingRemote, 'config', 'receive.denyDeletes', 'false');

    const otherRepo = join(root, 'other');
    mkdirSync(otherRepo, { recursive: true });
    git(otherRepo, 'init', '-b', 'main');
    git(otherRepo, 'config', 'user.email', 'other@test');
    git(otherRepo, 'config', 'user.name', 'Other E2E');
    writeFileSync(join(otherRepo, 'other.txt'), 'other\n');
    git(otherRepo, 'add', '.');
    git(otherRepo, 'commit', '-m', 'other');

    const resumed = await launchApp({ userData });
    app = resumed.app;
    page = resumed.page;
    await openBranches(page);

    const todo = page.getByTestId('cleanup-recovery-todo');
    await expect(todo).toContainText('checksum 相符的原始證據', { timeout: 30_000 });
    await stubFolderPicker(app, [otherRepo]);
    await addWorkspaceViaUI(page);
    await openBranches(page);
    await expect(page.getByTestId('cleanup-recovery-todo')).toHaveCount(0);
    await page.locator('button[aria-label="開啟工作區 work"]').click();
    await expect(page.getByRole('contentinfo', { name: '狀態列' })).toContainText('work');
    await openBranches(page);
    await expect(todo).toContainText('checksum 相符的原始證據');
    await todo.getByRole('button', { name: '匯入驗證證據' }).click();
    await page.getByLabel('journal payload JSON').fill(evidenceJson);
    await page.getByRole('button', { name: '驗證並匯入' }).click();
    await expect(todo).toContainText('只能沿 journal checkpoint 繼續收斂', { timeout: 30_000 });
    await todo.getByRole('button', { name: '繼續收斂' }).click();
    await expect(todo).toHaveCount(0, { timeout: 60_000 });
    expect(git(rejectingRemote, 'for-each-ref', '--format=%(refname)', 'refs/heads/remote-delete').trim()).toBe('');
    expect(git(repo, 'for-each-ref', '--format=%(refname)', 'refs/remotes/team/backend/remote-delete').trim()).toBe('');
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('遠端 tip 在風險確認後變動時拒絕舊租約且不刪新 commit', async () => {
  test.setTimeout(180_000);
  const { root, repo, remote } = seedRepo();
  const replacementOid = git(repo, 'rev-parse', 'unfinished').trim();
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]);
    await addWorkspaceViaUI(page);
    await openBranches(page);

    await page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' }).click();
    await page.getByRole('menuitem', { name: '刪除遠端分支', exact: true }).click();
    await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60_000 });
    git(repo, 'push', '--force', remote, 'unfinished:refs/heads/remote-delete');
    await page.getByRole('button', { name: '開始完整清理' }).click();

    await expect(page.locator('.pd-scm-error')).toContainText('狀態已變更', { timeout: cleanupTimeout });
    expect(git(remote, 'rev-parse', 'refs/heads/remote-delete').trim()).toBe(replacementOid);
    await expect(page.getByTestId('cleanup-recovery-todo')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('刪除目前分支時先切換到使用者選定分支，再以同一流程清理', async () => {
  test.setTimeout(180_000);
  const { root, repo } = seedRepo();
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [repo]);
    await addWorkspaceViaUI(page);
    await openBranches(page);

    await page.getByRole('button', { name: '更多本地分支操作 main' }).click();
    await page.getByRole('menuitem', { name: '刪除本地分支（目前分支）' }).click();
    const switchTo = page.getByLabel('目前正在使用此分支，先切換到');
    await switchTo.selectOption('merged-local');
    await page.getByRole('button', { name: '檢查清理風險' }).click();
    await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '開始完整清理' }).click();

    await expect.poll(() => git(repo, 'branch', '--show-current').trim(), { timeout: cleanupTimeout }).toBe('merged-local');
    await expect.poll(() => git(repo, 'branch', '--list', 'main').trim(), { timeout: cleanupTimeout }).toBe('');
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
