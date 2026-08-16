import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ONBOARDING_VERSION } from '../src/shared/constants';
import type { OnboardingState } from '../src/shared/types';
import { launchApp } from './electronApp';

test.describe.configure({ mode: 'serial' });

function seedState(schemaVersion: number, onboarding?: OnboardingState): string {
  const userData = mkdtempSync(join(tmpdir(), 'polydesk-onboarding-'));
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ schemaVersion, onboarding }), 'utf-8');
  return userData;
}

function readOnboarding(userData: string): OnboardingState {
  const state = JSON.parse(readFileSync(join(userData, 'state.json'), 'utf-8')) as { onboarding: OnboardingState };
  return state.onboarding;
}

async function openManualTour(page: Page): Promise<void> {
  await page.getByRole('button', { name: '說明', exact: true }).click();
  await page.getByRole('menuitem', { name: '教學導覽…' }).click();
}

async function cleanup(apps: ElectronApplication[], userDataPaths: string[]): Promise<void> {
  for (const app of [...apps].reverse()) await app.close().catch(() => undefined);
  for (const userData of userDataPaths) {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('首次導覽會保存進度、續接並在完成後不再自動出現', async () => {
  test.setTimeout(180_000);
  const apps: ElectronApplication[] = [];
  const first = await launchApp({ showOnboarding: true });
  apps.push(first.app);
  const { page, userData } = first;

  try {
    const tour = page.locator('.pd-tour-card');
    await expect(tour).toHaveAccessibleName(/教學導覽：歡迎來到 Polydesk/);
    await expect(tour).toContainText('01 / 07');
    await expect(page.locator('.pd-tour-highlight')).toBeVisible();
    await expect(page.getByRole('button', { name: '上一步' })).toBeDisabled();

    await page.getByRole('button', { name: '下一步' }).click();
    await expect(tour).toContainText('02 / 07');
    await page.getByRole('button', { name: '上一步' }).click();
    await expect(tour).toContainText('01 / 07');
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(tour).toContainText('03 / 07');
    await expect.poll(() => readOnboarding(userData)).toEqual({ version: ONBOARDING_VERSION, status: 'in-progress', step: 2 });
    await first.app.close();

    const resumed = await launchApp({ userData, showOnboarding: true });
    apps.push(resumed.app);
    const resumedTour = resumed.page.locator('.pd-tour-card');
    await expect(resumedTour).toContainText('03 / 07');
    for (const count of ['04 / 07', '05 / 07', '06 / 07', '07 / 07']) {
      await resumed.page.getByRole('button', { name: '下一步' }).click();
      await expect(resumedTour).toContainText(count);
    }
    await resumed.page.getByRole('button', { name: '完成' }).click();
    await expect(resumedTour).toHaveCount(0);
    await expect.poll(() => readOnboarding(userData)).toEqual({ version: ONBOARDING_VERSION, status: 'completed', step: 0 });
    await resumed.app.close();

    const completed = await launchApp({ userData, showOnboarding: true });
    apps.push(completed.app);
    await expect(completed.page.locator('.pd-tour-card')).toHaveCount(0);
    await completed.app.close();
  } finally {
    await cleanup(apps, [userData]);
  }
});

test('schema v2 與舊導覽版本從第 1 步開始，缺少目標時提供不阻塞替代內容', async () => {
  test.setTimeout(120_000);
  const apps: ElectronApplication[] = [];
  const legacyUserData = seedState(2);
  const staleUserData = seedState(3, { version: ONBOARDING_VERSION - 1, status: 'completed', step: 6 });

  try {
    const legacy = await launchApp({ userData: legacyUserData, showOnboarding: true });
    apps.push(legacy.app);
    await expect(legacy.page.locator('.pd-tour-card')).toContainText('01 / 07');
    await legacy.page.getByRole('button', { name: '略過導覽' }).click();
    await expect.poll(() => readOnboarding(legacyUserData)).toEqual({ version: ONBOARDING_VERSION, status: 'skipped', step: 0 });
    await legacy.app.close();

    const stale = await launchApp({ userData: staleUserData, showOnboarding: true });
    apps.push(stale.app);
    const staleTour = stale.page.locator('.pd-tour-card');
    await expect(staleTour).toContainText('01 / 07');
    await stale.page.locator('[data-tour="workspace-rail"]').evaluate((element) => element.remove());
    await stale.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect(stale.page.getByText('目前視窗無法完整顯示目標區域，導覽仍可繼續，不會卡住。')).toBeVisible();
    for (const count of ['02 / 07', '03 / 07', '04 / 07', '05 / 07', '06 / 07', '07 / 07']) {
      await stale.page.getByRole('button', { name: '下一步' }).click();
      await expect(staleTour).toContainText(count);
    }
    await stale.page.getByRole('button', { name: '完成' }).click();
    await expect.poll(() => readOnboarding(staleUserData)).toEqual({ version: ONBOARDING_VERSION, status: 'completed', step: 0 });
    await stale.app.close();
  } finally {
    await cleanup(apps, [legacyUserData, staleUserData]);
  }
});

test('說明與設定共用入口可搜尋完整指南，手動導覽不改寫首次狀態', async () => {
  test.setTimeout(120_000);
  const apps: ElectronApplication[] = [];
  const userData = seedState(3, { version: ONBOARDING_VERSION, status: 'completed', step: 0 });

  try {
    const first = await launchApp({ userData, showOnboarding: true });
    apps.push(first.app);
    const { page } = first;
    await expect(page.locator('.pd-tour-card')).toHaveCount(0);

    await page.getByRole('button', { name: '說明', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: '教學導覽…' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '使用說明…' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '關於 Polydesk' })).toBeVisible();
    await page.getByRole('menuitem', { name: '使用說明…' }).click();
    await expect(page.getByRole('heading', { name: '使用說明', exact: true })).toBeVisible();
    await page.getByLabel('搜尋使用說明').fill('AI 產生 commit 訊息');
    await expect(page.getByRole('heading', { name: 'AI 產生 commit 訊息', exact: true })).toBeVisible();
    await expect(page.getByText('產生功能不會自動 commit。', { exact: false })).toBeVisible();
    await page.getByLabel('搜尋使用說明').fill('服務用量');
    await expect(page.getByRole('heading', { name: '總覽與 AI 用量', exact: true })).toBeVisible();
    await expect(page.getByText('Agy CLI 目前不提供用量資料', { exact: false })).toBeVisible();
    await page.getByLabel('搜尋使用說明').fill('等待確認');
    await expect(page.getByText('等待確認', { exact: true }).first()).toBeVisible();
    await page.getByLabel('使用說明分類').getByRole('button', { name: /問題排除/ }).click();
    await expect(page.getByText('信任、確認與安全限制', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '關閉使用說明' }).click();

    await page.getByRole('button', { name: '設定', exact: true }).click();
    await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '教學導覽', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '使用說明', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '教學導覽', exact: true }).click();
    const manualTour = page.locator('.pd-tour-card');
    await expect(manualTour).toContainText('01 / 07');
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '結束導覽' }).click();
    await expect.poll(() => readOnboarding(userData)).toEqual({ version: ONBOARDING_VERSION, status: 'completed', step: 0 });
    await first.app.close();

    const reopened = await launchApp({ userData, showOnboarding: true });
    apps.push(reopened.app);
    await expect(reopened.page.locator('.pd-tour-card')).toHaveCount(0);
    await reopened.app.close();
  } finally {
    await cleanup(apps, [userData]);
  }
});

test('導覽只還原自己顯示且未被使用者覆寫的區域', async () => {
  test.setTimeout(150_000);
  const apps: ElectronApplication[] = [];
  const userData = seedState(3, { version: ONBOARDING_VERSION, status: 'completed', step: 0 });

  try {
    const launched = await launchApp({ userData, showOnboarding: true });
    apps.push(launched.app);
    const { page } = launched;
    const workspace = page.getByRole('button', { name: '切換工作區列顯示' });
    const sidebar = page.getByRole('button', { name: '切換側欄顯示' });
    const editor = page.getByRole('button', { name: '切換編輯器顯示' });
    const terminal = page.getByRole('button', { name: '切換終端機顯示' });

    for (const button of [workspace, sidebar, editor, terminal]) await button.click();
    await expect(page.locator('aside[aria-label="工作區列表"]')).toHaveCount(0);
    for (const button of [sidebar, editor, terminal]) await expect(button).toHaveAttribute('aria-pressed', 'false');

    await openManualTour(page);
    await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible();
    for (let step = 1; step < 4; step += 1) await page.getByRole('button', { name: '下一步' }).click();
    await expect(sidebar).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(editor).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(terminal).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '結束導覽' }).click();
    await expect(page.locator('aside[aria-label="工作區列表"]')).toHaveCount(0);
    for (const button of [sidebar, editor, terminal]) await expect(button).toHaveAttribute('aria-pressed', 'false');

    await openManualTour(page);
    for (let step = 1; step < 4; step += 1) await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(editor).toHaveAttribute('aria-pressed', 'true');
    await editor.click({ force: true });
    await editor.click({ force: true });
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '結束導覽' }).click();

    await expect(page.locator('aside[aria-label="工作區列表"]')).toHaveCount(0);
    await expect(sidebar).toHaveAttribute('aria-pressed', 'false');
    await expect(editor).toHaveAttribute('aria-pressed', 'true');
    await expect(terminal).toHaveAttribute('aria-pressed', 'false');
    await launched.app.close();
  } finally {
    await cleanup(apps, [userData]);
  }
});
