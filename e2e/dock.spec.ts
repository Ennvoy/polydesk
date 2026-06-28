// F-10 驗證（REQ-UI-002/003、REQ-PERSIST-003）：版面顯隱/最大化/一鍵重設 + 重啟還原。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp } from './electronApp';

const TERM_MARK = '請先選擇工作區後再開啟終端機'; // 終端機面板空狀態文字（panel 可見性 marker）

test('F-10：終端機顯隱 / 一鍵重設 / 重啟還原', async () => {
  const first = await launchApp();
  const { page, userData } = first;
  await expect(page.locator('[role="toolbar"][aria-label="版面控制"]')).toBeVisible();
  // 終端機預設可見
  await expect(page.getByText(TERM_MARK)).toBeVisible({ timeout: 12000 });

  // 切換終端機顯示 → 隱藏
  await page.locator('button[aria-label="切換終端機顯示"]').click();
  await expect(page.getByText(TERM_MARK)).toHaveCount(0, { timeout: 8000 });

  // 再切換 → 回來
  await page.locator('button[aria-label="切換終端機顯示"]').click();
  await expect(page.getByText(TERM_MARK)).toBeVisible({ timeout: 8000 });

  // 隱藏終端機 → 關閉 → 重啟同 userData → 仍隱藏（持久化還原）
  await page.locator('button[aria-label="切換終端機顯示"]').click();
  await expect(page.getByText(TERM_MARK)).toHaveCount(0, { timeout: 8000 });
  await first.app.close();

  const second = await launchApp({ userData });
  await expect(second.page.locator('[role="toolbar"][aria-label="版面控制"]')).toBeVisible();
  await expect(second.page.getByText(TERM_MARK)).toHaveCount(0, { timeout: 12000 });
  // 一鍵重設 → 終端機回來
  await second.page.locator('button[aria-label="重設版面"]').click();
  await expect(second.page.getByText(TERM_MARK)).toBeVisible({ timeout: 8000 });
  await second.app.close();

  rmSync(userData, { recursive: true, force: true });
});
