// 按 X 完整退出（REQ-WS-009 app 層 + REQ-TERM-007 延伸至 app 關閉）：
// 有 alive 終端機 → 標題列 X → 確認彈窗列出跑中終端機 → 「全部關閉並退出」→
// app 主程序於時限內真實退出、PTY shell 子程序全滅（不留工作管理員殭屍）。
// 無終端機 → 按 X 靜默完整退出；彈窗按取消 → 不關閉、終端機不死。
import { test, expect } from '@playwright/test';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pdclose-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** pid 是否還活著（signal 0 探測，Windows 適用）。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 測試失敗/紅燈時的殭屍清理（best-effort，不污染機器）。 */
function forceTreeKill(pid: number): void {
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {
    /* 可能已退出 */
  });
}

/** 收尾：殺殘留程序樹、等主程序死透、刪暫存目錄（shell 殘留握 cwd 時刪不掉——不蓋掉主斷言）。 */
async function cleanup(mainPid: number, ...paths: string[]): Promise<void> {
  forceTreeKill(mainPid);
  await until(() => !pidAlive(mainPid), 5_000);
  for (const p of paths) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* 殘留在 %TEMP%，OS 之後清 */
    }
  }
}

/** 等主程序 exit（含已退出的情況），逾時回 false。 */
function waitExit(proc: ChildProcess, ms: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

/** 輪詢直到條件成立或逾時。 */
async function until(cond: () => boolean, ms: number, step = 250): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (cond()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, step));
  }
}

test('REQ-WS-009：有跑中終端機按 X → 確認彈窗 → 確認後 app 完整退出、shell 子程序全滅', async () => {
  const dir = seedDir('close-ws');
  const { app, page, userData } = await launchApp();
  const proc = app.process();
  const mainPid = proc.pid!;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 close-ws"]').click();

    // 開一個終端機（real PTY，alive）
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first()).toBeVisible({
      timeout: 15_000,
    });

    // 真實鏈路證據：經 PTY 讓 shell 把自己的 PID 寫進工作區檔案
    // （不走 Get-CimInstance——這台機器 CIM 掃描慢到逾時，見 reference_win11_no_wmic_cim_slow）
    await page.waitForTimeout(1500); // shell 初始化 prompt
    await page.locator('.pd-term-view').first().click(); // 聚焦 xterm helper textarea
    await page.keyboard.type('Set-Content pid.txt "$PID" -Encoding Ascii');
    await page.keyboard.press('Enter');
    let shellPid = 0;
    await expect
      .poll(
        () => {
          try {
            shellPid = Number.parseInt(readFileSync(join(dir, 'pid.txt'), 'utf8').trim(), 10);
          } catch {
            shellPid = 0;
          }
          return shellPid;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    expect(pidAlive(shellPid), 'PTY shell 應存活中').toBe(true);

    // 標題列 X → 確認彈窗（列出跑中終端機）→ 全部關閉並退出
    await page.locator('button[aria-label="關閉視窗"]').click();
    const confirmBtn = page.locator('button:has-text("全部關閉並退出")').first();
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    await confirmBtn.click();

    expect(await waitExit(proc, 10_000), 'app 主程序應於 10s 內完整退出（不留工作管理員殭屍）').toBe(true);
    const shellGone = await until(() => !pidAlive(shellPid), 5_000);
    expect(shellGone, `PTY shell 子程序（pid=${shellPid}）應隨 app 退出被殺`).toBe(true);
  } finally {
    await cleanup(mainPid, dir, userData);
  }
});

test('無跑中終端機按 X → 不彈窗、直接完整退出', async () => {
  const dir = seedDir('close-empty');
  const { app, page, userData } = await launchApp();
  const proc = app.process();
  const mainPid = proc.pid!;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);

    await page.locator('button[aria-label="關閉視窗"]').click();
    expect(await waitExit(proc, 10_000), 'app 主程序應於 10s 內完整退出').toBe(true);
  } finally {
    await cleanup(mainPid, dir, userData);
  }
});

test('確認彈窗按取消 → 不關閉、終端機仍活；再按 X 確認後退出', async () => {
  const dir = seedDir('close-cancel');
  const { app, page, userData } = await launchApp();
  const proc = app.process();
  const mainPid = proc.pid!;
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 close-cancel"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first()).toBeVisible({
      timeout: 15_000,
    });

    // X → 彈窗 → 取消：視窗與終端機都不動
    await page.locator('button[aria-label="關閉視窗"]').click();
    const cancelBtn = page.locator('button:has-text("取消")').first();
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();
    await expect(page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first()).toBeVisible();
    expect(pidAlive(mainPid)).toBe(true);

    // 再按 X → 確認 → 完整退出
    await page.locator('button[aria-label="關閉視窗"]').click();
    const confirmBtn = page.locator('button:has-text("全部關閉並退出")').first();
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    await confirmBtn.click();
    expect(await waitExit(proc, 10_000), '確認後 app 主程序應於 10s 內完整退出').toBe(true);
  } finally {
    await cleanup(mainPid, dir, userData);
  }
});
