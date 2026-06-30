// F-10 驗證（REQ-UI-002/003、REQ-PERSIST-003）：版面顯隱/最大化/一鍵重設 + 重啟還原。
// 顯隱改 group.setVisible（不 dispose、不移除 DOM）後，以 toolbar 鈕的 aria-pressed（= 單一真相
// panelVisibleById/group.isVisible）判顯隱；顯示時另以空狀態文字可見性 sanity。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp } from './electronApp';

const TERM_MARK = '請先選擇工作區後再開啟終端機'; // 終端機面板空狀態文字（顯示時可見性 sanity）

test('F-10：終端機顯隱 / 一鍵重設 / 重啟還原', async () => {
  const first = await launchApp();
  const { page, userData } = first;
  await expect(page.locator('[role="toolbar"][aria-label="版面控制"]')).toBeVisible();
  const termToggle = page.locator('button[aria-label="切換終端機顯示"]');
  // 終端機預設可見
  await expect(termToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 12000 });
  await expect(page.getByText(TERM_MARK)).toBeVisible({ timeout: 12000 });

  // 切換終端機顯示 → 隱藏（setVisible(false)：toolbar 態反映不可見、splitview 收容器騰空間）
  await termToggle.click();
  await expect(termToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });

  // 再切換 → 回來
  await termToggle.click();
  await expect(termToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(page.getByText(TERM_MARK)).toBeVisible({ timeout: 8000 });

  // 隱藏終端機 → 關閉 → 重啟同 userData → 仍隱藏（持久化還原）
  await termToggle.click();
  await expect(termToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  await first.app.close();

  const second = await launchApp({ userData });
  await expect(second.page.locator('[role="toolbar"][aria-label="版面控制"]')).toBeVisible();
  const termToggle2 = second.page.locator('button[aria-label="切換終端機顯示"]');
  await expect(termToggle2).toHaveAttribute('aria-pressed', 'false', { timeout: 12000 }); // 持久化還原：仍隱藏
  // 一鍵重設 → 終端機回來
  await second.page.locator('button[aria-label="重設版面"]').click();
  await expect(termToggle2).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(second.page.getByText(TERM_MARK)).toBeVisible({ timeout: 8000 });
  await second.app.close();

  rmSync(userData, { recursive: true, force: true });
});
