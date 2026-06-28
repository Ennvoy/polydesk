// E2E 啟動輔助：以 _electron 啟動已 build 的 Polydesk，隔離 userData（POLYDESK_USER_DATA）。
// 提供 seedWorkspace 等真實鏈路工具（經真 fs 建資料夾，由真 IPC 加入工作區）。

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

const mainEntry = (): string => join(process.cwd(), 'out', 'main', 'index.js');

export async function launchApp(opts?: { userData?: string }): Promise<LaunchedApp> {
  const userData = opts?.userData ?? mkdtempSync(join(tmpdir(), 'polydesk-e2e-'));
  const app = await electron.launch({
    args: [mainEntry()],
    cwd: process.cwd(),
    env: { ...process.env, POLYDESK_USER_DATA: userData } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData };
}

/** 建立一個真實暫存資料夾當工作區來源（可選 git init 由呼叫端做）。 */
export function makeTempDir(prefix = 'polydesk-ws-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeSubDir(root: string, name: string): string {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * 在 main 程序覆寫原生資料夾選擇對話框，使其依序回傳預先 seed 的真實資料夾路徑。
 * 這是控制「OS 原生對話框」（無法被 Playwright 點擊），非 mock app 邏輯——
 * workspace.add / 真 fs / 持久化全程真實。
 */
export async function stubFolderPicker(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(async ({ dialog }, queued: string[]) => {
    const q = [...queued];
    // @ts-expect-error 測試覆寫
    dialog.showOpenDialog = async () => ({ canceled: q.length === 0, filePaths: q.length ? [q.shift()] : [] });
  }, paths);
}

/** 透過真實 UI 流程新增一個工作區（stub picker 已 seed 路徑）：點「新增工作區」→ TrustConfirm 信任確認。 */
export async function addWorkspaceViaUI(page: Page): Promise<void> {
  await page.locator('button[aria-label="新增工作區"]').first().click();
  await page.locator('button[aria-label="信任並新增工作區"]').click();
}
