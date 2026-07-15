// 發佈到 GitHub＋push 智慧補救（DF-12）三案：
//  1) 沒 upstream 自動 push -u：全真鏈路（真 bare remote、真 push、真 upstream 驗證），零 mock。
//  2) 無 remote → 同步列「發佈」鈕＋對話框驗證＋gh 缺席人話引導（POLYDESK_GH_BIN 指向真實但錯誤的
//     二進位——走完整 IPC→main→分類→UI 鏈，僅外部 gh 邊界受控，比照 stubFolderPicker 慣例）。
//  3) 成功路徑：Add-Type 編譯受控 gh shim exe（記錄 argv、回假 URL）→ 驗證 gh 收到的完整參數
//     與 UI 成功態（repo create <name> --private --source <ws> --remote origin --push）。
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function seedRepo(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'e2e@polydesk.test');
  git(dir, 'config', 'user.name', 'Polydesk E2E');
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`, 'utf8');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

async function openScm(page: Page, wsName: string): Promise<void> {
  await page.locator(`button[aria-label="開啟工作區 ${wsName}"]`).click();
  await page.locator('button[aria-label="原始碼控制"]').click();
  await expect(page.locator('.pd-scm-syncbar')).toBeVisible({ timeout: 15_000 });
}

test('沒 upstream 的新分支按 push → 自動 push -u 設 upstream（全真鏈路）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-pushu-'));
  const dir = seedRepo(root, 'pushu-ws');
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
  git(dir, 'remote', 'add', 'origin', bare);
  // 前置確認：目前分支沒有 upstream（rev-parse @{u} 必失敗）
  expect(() => git(dir, 'rev-parse', '--abbrev-ref', 'main@{u}')).toThrow();

  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await openScm(page, 'pushu-ws');

    // 有 remote → 顯示一般 push 鈕（非發佈鈕）
    const pushBtn = page.locator('.pd-scm-syncbtns button[aria-label^="推送"]');
    await expect(pushBtn).toBeVisible();
    await pushBtn.click();

    // 真實資料鏈路驗證：upstream 設好、commit 真的進了 bare remote、UI 無錯誤
    await expect
      .poll(() => {
        try {
          return git(dir, 'rev-parse', '--abbrev-ref', 'main@{u}');
        } catch {
          return '';
        }
      }, { timeout: 15_000 })
      .toBe('origin/main');
    expect(git(bare, 'rev-parse', 'main')).toBe(git(dir, 'rev-parse', 'HEAD'));
    await expect(page.locator('.pd-scm-error')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('無 remote → 同步列顯示「發佈」；名稱驗證；gh 缺席給安裝引導', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-pub-noremote-'));
  const dir = seedRepo(root, 'publish-ws');
  // gh 邊界受控：指向真實存在但不是 gh 的二進位（--version 必失敗）→ 走 gh-not-found 分類
  const { app, page, userData } = await launchApp({
    env: { POLYDESK_GH_BIN: 'C:\\Windows\\System32\\where.exe' },
  });
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await openScm(page, 'publish-ws');

    // 無 remote → pull/push 收起、顯示發佈鈕
    const publishBtn = page.locator('button[aria-label="發佈到 GitHub"]');
    await expect(publishBtn).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pd-scm-syncbtns button[aria-label^="推送"]')).toHaveCount(0);

    await publishBtn.click();
    await expect(page.getByRole('heading', { name: '發佈到 GitHub' })).toBeVisible();
    const nameInput = page.getByLabel('GitHub Repository 名稱');
    await expect(nameInput).toHaveValue('publish-ws'); // 預設＝資料夾名

    // 名稱驗證：非法字元 → inline 錯誤＋送出鈕禁用（純函式驗證未過永不打 IPC）
    await nameInput.fill('我的專案');
    await expect(page.getByText('名稱只能使用英數字與 - _ .（GitHub 限制）。')).toBeVisible();
    await expect(page.getByRole('button', { name: '建立 GitHub repository 並推送' })).toBeDisabled();

    // 合法名稱＋gh 缺席 → 安裝引導人話
    await nameInput.fill('pd-e2e-publish');
    await page.getByRole('button', { name: '建立 GitHub repository 並推送' }).click();
    await expect(page.getByText(/找不到 GitHub CLI/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '取消發佈' }).click();
    await expect(page.getByRole('heading', { name: '發佈到 GitHub' })).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('發佈成功路徑：gh shim 收到完整參數、UI 顯示已發佈 URL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-pub-ok-'));
  const dir = seedRepo(root, 'publish-ok-ws');
  const shimDir = join(root, 'shim');
  mkdirSync(shimDir, { recursive: true });
  const shimExe = join(shimDir, 'ghshim.exe');
  const logFile = join(shimDir, 'gh-args.log');
  // 受控 gh shim（僅外部服務邊界；app 內 IPC/驗證/git 檢查全真）：記 argv、回假 URL。
  // log 路徑寫死在 exe 旁（app spawn gh 走 REQ-SEC-002 白名單 env，自訂變數傳不進去——by design）。
  const cs = [
    'using System; using System.IO;',
    'class P { static int Main(string[] a) {',
    '  var log = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "gh-args.log");',
    '  File.AppendAllText(log, string.Join("\\u0001", a) + "\\n");',
    '  if (a.Length > 0 && a[0] == "--version") { Console.WriteLine("gh version 0.0.0-shim"); return 0; }',
    '  if (a.Length > 0 && a[0] == "auth") { return 0; }',
    '  Console.WriteLine("https://github.com/shim-user/" + (a.Length > 2 ? a[2] : "repo") + ".git");',
    '  return 0; } }',
  ].join('\n');
  try {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -TypeDefinition @'\n${cs}\n'@ -Language CSharp -OutputAssembly '${shimExe}' -OutputType ConsoleApplication`,
    ], { stdio: 'pipe' });
  } catch {
    test.skip(true, '本機無法以 Add-Type 編譯 shim（缺 .NET csc）');
  }
  test.skip(!existsSync(shimExe), 'shim 編譯未產出');

  const { app, page, userData } = await launchApp({
    env: { POLYDESK_GH_BIN: shimExe },
  });
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await openScm(page, 'publish-ok-ws');

    await page.locator('button[aria-label="發佈到 GitHub"]').click();
    await page.getByLabel('GitHub Repository 名稱').fill('pd-e2e-ok');
    await page.getByRole('button', { name: '建立 GitHub repository 並推送' }).click();

    // UI 成功態＋URL（.git 字尾已剝除）
    await expect(page.getByRole('heading', { name: '已發佈到 GitHub' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('https://github.com/shim-user/pd-e2e-ok')).toBeVisible();
    await page.getByRole('button', { name: '完成發佈' }).click();

    // shim 收到的最後一組 argv＝完整 repo create 參數（--private 預設、--source 指向工作區、--push）
    const lines = readFileSync(logFile, 'utf8').trim().split('\n');
    const createArgs = lines[lines.length - 1].split(String.fromCharCode(1));
    expect(createArgs.slice(0, 3)).toEqual(['repo', 'create', 'pd-e2e-ok']);
    expect(createArgs).toContain('--private');
    expect(createArgs).toContain('--push');
    expect(createArgs).toContain('--remote');
    expect(createArgs).toContain('origin');
    const srcIdx = createArgs.indexOf('--source');
    expect(srcIdx).toBeGreaterThan(-1);
    expect(createArgs[srcIdx + 1].toLowerCase()).toContain('publish-ok-ws');
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
