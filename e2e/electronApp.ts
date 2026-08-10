// E2E 啟動輔助：以 _electron 啟動已 build 的 Polydesk，隔離 userData（POLYDESK_USER_DATA）。
// 提供 seedWorkspace 等真實鏈路工具（經真 fs 建資料夾，由真 IPC 加入工作區）。

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURRENT_SCHEMA_VERSION } from '../src/main/store/schema';
import { ONBOARDING_VERSION } from '../src/shared/constants';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

export interface LaunchOptions {
  userData?: string;
  env?: Record<string, string>;
  showOnboarding?: boolean;
}

const mainEntry = (): string => join(process.cwd(), 'out', 'main', 'index.js');

export async function launchRawApp(opts?: LaunchOptions): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = opts?.userData ?? mkdtempSync(join(tmpdir(), 'polydesk-e2e-'));
  // 多數既有 E2E 測的是各自功能，不應被首次導覽卡片遮住。只有導覽專案明確要求時
  // 才保留真正的全新狀態；若呼叫端已 seed state.json，絕不覆蓋。
  const statePath = join(userData, 'state.json');
  if (!opts?.showOnboarding && !existsSync(statePath)) {
    mkdirSync(userData, { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      onboarding: { version: ONBOARDING_VERSION, status: 'completed', step: 0 },
    }), 'utf-8');
  }
  const app = await electron.launch({
    args: [mainEntry()],
    cwd: process.cwd(),
    env: { ...process.env, POLYDESK_USER_DATA: userData, ...opts?.env } as Record<string, string>,
  });
  return { app, userData };
}

export async function launchApp(opts?: LaunchOptions): Promise<LaunchedApp> {
  const { app, userData } = await launchRawApp(opts);
  // splash 也是 BrowserWindow；必須挑出真正的 renderer 主視窗，不能把 data: splash
  // 誤當成待測頁面。
  const deadline = Date.now() + 12_000;
  let page: Page | undefined;
  while (!page && Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const url = candidate.url();
      if (!url.startsWith('data:') && (url.includes('/renderer/index.html') || url.includes('localhost'))) {
        page = candidate;
        break;
      }
    }
    if (!page) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!page) {
    await app.close();
    throw new Error('等待 Polydesk 主視窗逾時');
  }
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

/**
 * 透過真實 UI 流程新增一個工作區（stub picker 已 seed 路徑）→ TrustConfirm 信任確認。
 * 無工作區時走歡迎頁「新增工作區」CTA；已有工作區時 rail 只剩「＋」選單 → 「新增工作區…」項目。
 */
export async function addWorkspaceViaUI(page: Page): Promise<void> {
  const direct = page.locator('button[aria-label="新增工作區"]').first();
  if (!(await direct.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="新增"]').first().click(); // 開 rail「＋」選單
  }
  await page.locator('button[aria-label="新增工作區"]').first().click();
  await page.locator('button[aria-label="信任並新增工作區"]').click();
}
