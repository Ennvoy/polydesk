// bug 修復驗證：點工作區列項的 Claude/Codex 徽章格（名字按鈕以外的區域）也能切換工作區。
// 修復前切換 onClick 只綁在名字按鈕上，點到左側徽章/圖示格會落空、無法切換（整列非可點）。
// 真實鏈路：真 UI 新增兩個工作區 → 用 DOM click 打在列項「徽章格」（firstElementChild，非名字按鈕）
// → 斷言 active 真的切過去（aria-current）；再點名字按鈕確認原路徑（含 stopPropagation）沒被破壞。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp, stubFolderPicker, addWorkspaceViaUI, makeTempDir, makeSubDir } from './electronApp';

test('點工作區列項的徽章格（非名字按鈕）也能切換工作區（整列可點）', async () => {
  const root = makeTempDir('pdwssw-');
  const dirA = makeSubDir(root, 'ws-alpha');
  const dirB = makeSubDir(root, 'ws-beta');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dirA, dirB]);
    // 第一個（空狀態 CTA）
    await addWorkspaceViaUI(page);
    // 第二個（rail「＋」選單）→ 成為 active
    await page.locator('button[aria-label="新增"]').click();
    await page.locator('button[aria-label="新增工作區"]').click();
    await page.locator('button[aria-label="信任並新增工作區"]').click();

    await expect(page.locator('.pdws-item')).toHaveCount(2);
    const alpha = page.locator('.pdws-item', { has: page.locator('button[aria-label="開啟工作區 ws-alpha"]') });
    const beta = page.locator('.pdws-item', { has: page.locator('button[aria-label="開啟工作區 ws-beta"]') });

    // 最後新增的 ws-beta 此刻 active、ws-alpha 非 active
    await expect(beta).toHaveAttribute('aria-current', 'true');
    await expect(alpha).not.toHaveAttribute('aria-current', 'true');

    // 打在 alpha 列項的「徽章格」＝該列 firstElementChild（名字按鈕之前的圖示/徽章位，非名字按鈕）。
    // 修復前：點這裡落空、不切換 → 此斷言會失敗；修復後：冒泡到列項 onClick 切換。
    await alpha.evaluate((el) => (el.firstElementChild as HTMLElement).click());
    await expect(alpha).toHaveAttribute('aria-current', 'true', { timeout: 5000 });
    await expect(beta).not.toHaveAttribute('aria-current', 'true');

    // 名字按鈕原路徑仍可切（確認 stopPropagation 沒把名字按鈕的切換一起擋掉）
    await page.locator('button[aria-label="開啟工作區 ws-beta"]').click();
    await expect(beta).toHaveAttribute('aria-current', 'true', { timeout: 5000 });
    await expect(alpha).not.toHaveAttribute('aria-current', 'true');
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
