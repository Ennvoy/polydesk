# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git-branch-management.spec.ts >> 分支管理：本地／遠端分組與兩階段完整清理真鏈路
- Location: e2e\git-branch-management.spec.ts:50:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator:  getByRole('button', { name: '重新整理' })
Expected: enabled
Received: disabled
Timeout:  120000ms

Call log:
  - Expect "toBeEnabled" getByRole('button', { name: '重新整理' }) with timeout 120000ms
  - waiting for getByRole('button', { name: '重新整理' })
    195 × locator resolved to <button disabled aria-label="重新整理" class="pd-scm-icon" title="重新整理（含取回遠端狀態）">⟳</button>
        - unexpected value "disabled"

```

```yaml
- button "重新整理" [disabled]: ⟳
```

# Test source

```ts
  34  |
  35  |   git(root, 'init', '--bare', remote);
  36  |   git(repo, 'remote', 'add', 'team/backend', remote);
  37  |   git(repo, 'push', '-u', 'team/backend', 'main');
  38  |   git(repo, 'push', 'team/backend', 'remote-delete');
  39  |   git(repo, 'push', 'team/backend', 'profile:deployed-profile');
  40  |   git(repo, 'branch', '--set-upstream-to=team/backend/deployed-profile', 'profile');
  41  |   git(repo, 'config', 'branch.unfinished.description', 'must be removed with branch metadata');
  42  |   return { root, repo, remote };
  43  | }
  44  |
  45  | async function openBranches(page: import('@playwright/test').Page): Promise<void> {
  46  |   await page.locator('button[aria-label="原始碼控制"]').click();
  47  |   await page.getByRole('tab', { name: '分支' }).click();
  48  | }
  49  |
  50  | test('分支管理：本地／遠端分組與兩階段完整清理真鏈路', async () => {
  51  |   test.setTimeout(1_500_000); // 既有逐步顯式等待合計 1320 秒，另預留 setup／teardown 180 秒。
  52  |   const timedStep = async <T>(name: string, run: () => Promise<T>): Promise<T> => test.step(name, async () => {
  53  |     const started = Date.now();
  54  |     try {
  55  |       return await run();
  56  |     } finally {
  57  |       console.log(`[branch-management] ${name}: ${Date.now() - started}ms`);
  58  |     }
  59  |   });
  60  |   const { root, repo, remote, app, page, userData } = await timedStep('setup', async () => {
  61  |     const fixture = seedRepo();
  62  |     const launched = await launchApp();
  63  |     return { ...fixture, ...launched };
  64  |   });
  65  |   try {
  66  |     await timedStep('profile/upstream', async () => {
  67  |       await stubFolderPicker(app, [repo]);
  68  |       await addWorkspaceViaUI(page);
  69  |       await openBranches(page);
  70  |
  71  |       const localGroup = page.getByRole('button', { name: /^本地分支 \d+$/ });
  72  |       const remoteGroup = page.getByRole('button', { name: /^遠端分支 \d+$/ });
  73  |       await expect(localGroup).toHaveAttribute('aria-expanded', 'true');
  74  |       await expect(remoteGroup).toHaveAttribute('aria-expanded', 'true');
  75  |       await expect(page.locator('[data-branch-kind="local"]')).toHaveCount(6, { timeout: 30_000 });
  76  |       await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(3, { timeout: 30_000 });
  77  |
  78  |       await remoteGroup.click();
  79  |       await expect(remoteGroup).toHaveAttribute('aria-expanded', 'false');
  80  |       await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(0);
  81  |       await remoteGroup.click();
  82  |       await expect(page.locator('[data-branch-kind="remote"]')).toHaveCount(3);
  83  |
  84  |       await page.getByRole('button', { name: '更多本地分支操作 profile' }).click();
  85  |       await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
  86  |       await page.getByLabel('連同檢查遠端同名／upstream 分支').check();
  87  |       await expect(page.getByRole('checkbox', { name: 'team/backend/deployed-profile' })).toBeChecked();
  88  |       await page.getByRole('button', { name: '檢查清理風險' }).click();
  89  |       await expect(page.getByRole('dialog')).toContainText('team/backend/deployed-profile', { timeout: 60_000 });
  90  |       await page.getByRole('button', { name: '開始完整清理' }).click();
  91  |       await expect(page.locator('[data-branch-kind="local"]', { hasText: 'profile' })).toHaveCount(0, { timeout: cleanupTimeout });
  92  |       expect(git(repo, 'branch', '--list', 'profile').trim()).toBe('');
  93  |       expect(git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/deployed-profile').trim()).toBe('');
  94  |
  95  |       const mainMore = page.getByRole('button', { name: '更多本地分支操作 main' });
  96  |       await expect(mainMore).toBeEnabled({ timeout: cleanupTimeout });
  97  |       await mainMore.click();
  98  |       await expect(page.getByRole('menuitem', { name: '刪除本地分支（目前分支）' })).toBeEnabled();
  99  |       await page.screenshot({ path: join(shotDir, 'ui-branch-management-groups.png') });
  100 |       await page.keyboard.press('Escape');
  101 |
  102 |       const busyRow = page.locator('[data-branch-kind="local"]', { hasText: 'busy-worktree' });
  103 |       await busyRow.click({ button: 'right' });
  104 |       await expect(page.getByRole('menuitem', { name: '刪除本地分支（由 worktree 使用中）' })).toBeEnabled();
  105 |       await page.keyboard.press('Escape');
  106 |     });
  107 |
  108 |     await timedStep('merged', async () => {
  109 |       await page.getByRole('button', { name: '更多本地分支操作 merged-local' }).click();
  110 |       await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
  111 |       await expect(page.getByRole('heading', { name: '完整清理分支' })).toBeVisible();
  112 |       await expect(page.getByRole('dialog')).toContainText('此畫面尚未開始刪除');
  113 |       expect(git(repo, 'branch', '--list', 'merged-local').trim()).toBe('merged-local');
  114 |       await page.getByRole('button', { name: '檢查清理風險' }).click();
  115 |       await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60_000 });
  116 |       await expect(page.getByRole('dialog')).toContainText('Git 判定可安全刪除');
  117 |       await page.getByRole('button', { name: '開始完整清理' }).click();
  118 |       await expect(page.locator('[data-branch-kind="local"]', { hasText: 'merged-local' })).toHaveCount(0, { timeout: cleanupTimeout });
  119 |       expect(git(repo, 'branch', '--list', 'merged-local').trim()).toBe('');
  120 |     });
  121 |
  122 |     const refreshButton = await timedStep('remote', async () => {
  123 |       const remoteDeleteMore = page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' });
  124 |       await expect(remoteDeleteMore).toBeEnabled({ timeout: cleanupTimeout });
  125 |       await remoteDeleteMore.click();
  126 |       await page.getByRole('menuitem', { name: '刪除遠端分支', exact: true }).click();
  127 |       await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60_000 });
  128 |       await expect(page.getByRole('dialog')).toContainText('team/backend/remote-delete');
  129 |       const deleteRemote = page.getByRole('button', { name: '開始完整清理' });
  130 |       await expect(deleteRemote).toHaveClass(/pd-btn-danger/);
  131 |       await deleteRemote.click();
  132 |       await expect.poll(() => git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/remote-delete').trim(), { timeout: cleanupTimeout }).toBe('');
  133 |       const refreshButton = page.getByRole('button', { name: '重新整理' });
> 134 |       await expect(refreshButton).toBeEnabled({ timeout: cleanupTimeout });
      |                                   ^ Error: expect(locator).toBeEnabled() failed
  135 |       await refreshButton.click();
  136 |       await expect(page.locator('[data-branch-kind="remote"]', { hasText: 'team/backend/remote-delete' })).toHaveCount(0, { timeout: 30_000 });
  137 |       expect(git(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/remote-delete').trim()).toBe('');
  138 |       expect(git(repo, 'branch', '--list', 'remote-delete').trim()).toBe('remote-delete');
  139 |       return refreshButton;
  140 |     });
  141 |
  142 |     await timedStep('unfinished', async () => {
  143 |       await page.getByRole('button', { name: '更多本地分支操作 unfinished' }).click();
  144 |       await page.getByRole('menuitem', { name: '刪除本地分支', exact: true }).click();
  145 |       await page.getByRole('button', { name: '檢查清理風險' }).click();
  146 |       await expect(page.getByRole('dialog')).toContainText('尚未安全合併', { timeout: 60_000 });
  147 |       await expect(page.getByRole('button', { name: '開始完整清理' })).toBeDisabled();
  148 |       await page.getByLabel('我確認強制清理本機未知／未合併內容').check();
  149 |       await expect(page.getByRole('button', { name: '開始完整清理' })).toBeEnabled();
  150 |       await page.getByRole('button', { name: '開始完整清理' }).click();
  151 |       await expect.poll(() => git(repo, 'branch', '--list', 'unfinished').trim(), { timeout: cleanupTimeout }).toBe('');
  152 |       await expect(refreshButton).toBeEnabled({ timeout: cleanupTimeout });
  153 |       await refreshButton.click();
  154 |       await expect(page.locator('[data-branch-kind="local"]', { hasText: 'unfinished' })).toHaveCount(0, { timeout: 30_000 });
  155 |       expect(git(repo, 'branch', '--list', 'unfinished').trim()).toBe('');
  156 |       expect(() => git(repo, 'config', '--get-regexp', '^branch\\.unfinished\\.')).toThrow();
  157 |       expect(() => git(repo, 'reflog', 'exists', 'refs/heads/unfinished')).toThrow();
  158 |     });
  159 |   } finally {
  160 |     await app.close();
  161 |     rmSync(userData, { recursive: true, force: true });
  162 |     rmSync(root, { recursive: true, force: true });
  163 |   }
  164 | });
  165 |
  166 | test('遠端多 endpoint 部分失敗後，重啟仍顯示待辦並可繼續收斂', async () => {
  167 |   test.setTimeout(360_000);
  168 |   const { root, repo, remote } = seedRepo();
  169 |   const rejectingRemote = join(root, 'rejecting.git');
  170 |   mkdirSync(rejectingRemote, { recursive: true });
  171 |   git(rejectingRemote, 'init', '--bare');
  172 |   git(repo, 'push', rejectingRemote, 'remote-delete:refs/heads/remote-delete');
  173 |   git(repo, 'config', '--add', 'remote.team/backend.pushurl', remote);
  174 |   git(repo, 'config', '--add', 'remote.team/backend.pushurl', rejectingRemote);
  175 |   git(rejectingRemote, 'config', 'receive.denyDeletes', 'true');
  176 |
  177 |   const first = await launchApp();
  178 |   let app = first.app;
  179 |   let page = first.page;
  180 |   const { userData } = first;
  181 |   try {
  182 |     await stubFolderPicker(app, [repo]);
  183 |     await addWorkspaceViaUI(page);
  184 |     await openBranches(page);
  185 |
  186 |     await page.getByRole('button', { name: '更多遠端分支操作 team/backend/remote-delete' }).click();
  187 |     await page.getByRole('menuitem', { name: '刪除遠端分支', exact: true }).click();
  188 |     await expect(page.getByRole('heading', { name: '確認完整清理風險' })).toBeVisible({ timeout: 60_000 });
  189 |     await expect(page.getByRole('dialog').locator('.pd-cleanup-remotes .pd-cleanup-card')).toHaveCount(2);
  190 |     await page.getByRole('button', { name: '開始完整清理' }).click();
  191 |
  192 |     const failedFeedback = page.getByTestId('cleanup-feedback');
  193 |     await expect(failedFeedback).toHaveAttribute('data-kind', 'failed', { timeout: cleanupTimeout });
  194 |     await expect(failedFeedback).toContainText('清理未完成，已停在安全點');
  195 |     await expect(failedFeedback).toContainText('遠端清理只有部分完成');
  196 |     await expect(failedFeedback.locator('.pd-scm-error-detail')).not.toHaveAttribute('open');
  197 |     await expect(failedFeedback.locator('.pd-scm-error-detail summary')).toHaveText('顯示技術細節');
  198 |     const recoveryTodo = page.getByTestId('cleanup-recovery-todo');
  199 |     await expect(recoveryTodo).toContainText('remote-delete', { timeout: cleanupTimeout });
  200 |     const recoveryMetrics = await recoveryTodo.evaluate((element) => ({
  201 |       clientWidth: element.clientWidth,
  202 |       scrollWidth: element.scrollWidth,
  203 |     }));
  204 |     expect(recoveryMetrics.scrollWidth).toBeLessThanOrEqual(recoveryMetrics.clientWidth + 1);
  205 |     const resumeBox = await recoveryTodo.getByRole('button', { name: '繼續收斂' }).boundingBox();
  206 |     expect(resumeBox?.width ?? 0).toBeGreaterThanOrEqual(110);
  207 |     await page.screenshot({ path: join(shotDir, 'ui-cleanup-recovery-responsive.png') });
  208 |     expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/remote-delete').trim()).toBe('');
  209 |     expect(git(rejectingRemote, 'for-each-ref', '--format=%(refname)', 'refs/heads/remote-delete').trim()).toBe(
  210 |       'refs/heads/remote-delete',
  211 |     );
  212 |
  213 |     await app.close();
  214 |     const activeDir = join(userData, 'branch-cleanup', 'active');
  215 |     const payloadFile = readdirSync(activeDir).find((file) => file.endsWith('.payload.json'));
  216 |     if (!payloadFile) throw new Error('expected active cleanup payload');
  217 |     const evidenceJson = readFileSync(join(activeDir, payloadFile), 'utf8');
  218 |     writeFileSync(join(activeDir, payloadFile), '{"tampered":true}', 'utf8');
  219 |     git(rejectingRemote, 'config', 'receive.denyDeletes', 'false');
  220 |
  221 |     const otherRepo = join(root, 'other');
  222 |     mkdirSync(otherRepo, { recursive: true });
  223 |     git(otherRepo, 'init', '-b', 'main');
  224 |     git(otherRepo, 'config', 'user.email', 'other@test');
  225 |     git(otherRepo, 'config', 'user.name', 'Other E2E');
  226 |     writeFileSync(join(otherRepo, 'other.txt'), 'other\n');
  227 |     git(otherRepo, 'add', '.');
  228 |     git(otherRepo, 'commit', '-m', 'other');
  229 |
  230 |     const resumed = await launchApp({ userData });
  231 |     app = resumed.app;
  232 |     page = resumed.page;
  233 |     await openBranches(page);
  234 |
```