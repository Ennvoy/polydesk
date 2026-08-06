import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const shotDir = process.env.PD_SHOT_DIR || join(process.cwd(), 'test-results');

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
  return { root, repo, remote };
}

async function openBranches(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('button[aria-label="原始碼控制"]').click();
  await page.getByRole('tab', { name: '分支' }).click();
}

test('分支管理：本地／遠端分組、雙入口、阻擋原因與安全刪除真鏈路', async () => {
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
    await expect(page.locator('[data-branch-kind="local"]')).toHaveCount(5);
    await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(2);

    await remoteGroup.click();
    await expect(remoteGroup).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(0);
    await remoteGroup.click();
    await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(2);

    await page.getByRole('button', { name: '更多本地分支操作 main' }).click();
    await expect(page.getByRole('menuitem', { name: '刪除本地分支（目前分支）' })).toBeDisabled();
    await page.screenshot({ path: join(shotDir, 'ui-branch-management-groups.png') });
    await page.keyboard.press('Escape');

    const busyRow = page.locator('[data-branch-kind="local"]', { hasText: 'busy-worktree' });
    await busyRow.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '刪除本地分支（由 worktree 使用中）' })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '更多本地分支操作 merged-local' }).click();
    await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
    await expect(page.getByRole('heading', { name: '刪除本地分支？' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('只會刪除這台電腦上的「merged-local」');
    await page.getByRole('button', { name: '刪除本地分支', exact: true }).click();
    await expect.poll(() => git(repo, 'branch', '--list', 'merged-local').trim()).toBe('');
    await expect(page.locator('[data-branch-kind="local"]', { hasText: 'merged-local' })).toHaveCount(0);

    await page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' }).click();
    await page.getByRole('menuitem', { name: '刪除遠端分支', exact: true }).click();
    await expect(page.getByRole('heading', { name: '刪除遠端分支？' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('從遠端「team/backend」刪除伺服器分支「remote-delete」');
    const deleteRemote = page.getByRole('button', { name: '刪除遠端分支', exact: true });
    await expect(deleteRemote).toHaveClass(/pd-btn-danger/);
    await deleteRemote.click();
    await expect.poll(() => git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/remote-delete').trim()).toBe('');
    expect(git(repo, 'branch', '--list', 'remote-delete').trim()).toBe('remote-delete');
    await expect(page.locator('[data-branch-kind="remote"]', { hasText: 'team/backend/remote-delete' })).toHaveCount(0);

    await page.getByRole('button', { name: '更多本地分支操作 unfinished' }).click();
    await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
    await page.getByRole('button', { name: '刪除本地分支', exact: true }).click();
    await expect(page.locator('.pd-scm-error')).toContainText('尚未合併');
    await expect(page.locator('[data-branch-kind="local"]', { hasText: 'unfinished' })).toBeVisible();
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
