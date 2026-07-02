// 回歸（fit 裁切）：終端機放大（隱藏編輯器/側欄）後，xterm 畫布不得超出 host 可視底部。
// 根因一：Chromium 在 border-box 下 getComputedStyle().height 含 padding，FitAddon 以 host（帶 padding）
// 量可用高度會多算 16px ≈ 一列 → 最後一列（Claude statusline 等）被裁在 status bar 下。
// 根因二：反震盪守衛容差 24px > 一列字高（~16px），小幅（<24px）真實尺寸變化被當回彈吞掉、永不重 fit。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pdfit-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 量測 xterm 畫布（.xterm-screen）相對 host 可視內容區的垂直/水平溢出（px；>0 = 被裁）。 */
async function measureOverflow(page: Page): Promise<{ bottom: number; right: number; rows: number } | null> {
  return page.evaluate(() => {
    const view = document.querySelector('.pd-term-view');
    const host = view?.firstElementChild as HTMLElement | null;
    const screen = view?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!host || !screen) return null;
    const hostR = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const contentBottom = hostR.bottom - (parseFloat(cs.paddingBottom) || 0);
    const contentRight = hostR.right - (parseFloat(cs.paddingRight) || 0);
    const sR = screen.getBoundingClientRect();
    return {
      bottom: sR.bottom - contentBottom,
      right: sR.right - contentRight,
      rows: Math.round(sR.height),
    };
  });
}

test('終端機放大/小幅縮放後，最後一列不被裁切（畫布不溢出 host）', async () => {
  const dir = seedDir('fit-ws');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 fit-ws"]').click();

  // 開一個真實終端機，等 xterm 掛載完成
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15000 });

  // 基準狀態（預設版面）：畫布不得超出 host（容 1px 次像素誤差）
  await expect
    .poll(async () => (await measureOverflow(page))?.bottom ?? Infinity, { timeout: 5000 })
    .toBeLessThanOrEqual(1);

  // 情境一（使用者截圖場景）：隱藏編輯器 → 終端機吃滿高度 → 仍不得裁切
  await page.locator('button[aria-label="切換編輯器顯示"]').click();
  await expect
    .poll(async () => (await measureOverflow(page))?.bottom ?? Infinity, { timeout: 5000 })
    .toBeLessThanOrEqual(1);

  // 情境二：再隱藏側欄（放到最大）→ 仍不得裁切
  await page.locator('button[aria-label="切換側欄顯示"]').click();
  await expect
    .poll(async () => (await measureOverflow(page))?.bottom ?? Infinity, { timeout: 5000 })
    .toBeLessThanOrEqual(1);

  // 情境三（守衛回歸）：視窗高度小幅 −18px（< 24px 容差、> 一列字高）→ 須重 fit、不得留下被裁的一列
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const b = win.getBounds();
    win.setBounds({ ...b, height: b.height - 18 });
  });
  await expect
    .poll(async () => (await measureOverflow(page))?.bottom ?? Infinity, { timeout: 5000 })
    .toBeLessThanOrEqual(1);

  // 右緣同樣不得溢出（cols 多算會裁最後一欄）
  const m = await measureOverflow(page);
  expect(m).not.toBeNull();
  expect(m!.right).toBeLessThanOrEqual(1);

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

/** 量測 .pd-term-view 實際底色與「當下 --bg 解析值」（xterm theme 的同一來源）。 */
async function measureViewBg(page: Page): Promise<{ view: string; themeBg: string } | null> {
  return page.evaluate(() => {
    const view = document.querySelector('.pd-term-view') as HTMLElement | null;
    if (!view) return null;
    const cssBg = getComputedStyle(view).getPropertyValue('--bg').trim();
    const probe = document.createElement('div');
    probe.style.color = cssBg;
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { view: getComputedStyle(view).backgroundColor, themeBg: expected };
  });
}

test('切主題時已開的終端機即時跟隨（dogfood 回報：切風格終端機不變）', async () => {
  const dir = seedDir('theme-ws');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 theme-ws"]').click();
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15000 });

  const before = await measureViewBg(page);
  expect(before).not.toBeNull();

  // 真實 UI 路徑切主題：活動列「設定」→ 套用暖色主題 → 關閉
  await page.locator('button[aria-label="設定"]').click();
  await page.locator('button[aria-label="套用暖色主題"]').click();
  await page.locator('button[aria-label="關閉設定"]').click();

  // 容器底色須跟上新主題的 --bg（applyTheme 先設 xterm theme 再漆容器：容器跟上＝xterm 未拋錯）
  await expect
    .poll(async () => {
      const m = await measureViewBg(page);
      return m && m.view === m.themeBg && m.view !== before!.view;
    }, { timeout: 5000 })
    .toBe(true);

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test('終端機容器底色＝xterm 背景色（整數格剩餘空間不露出主題底色＝無留白框）', async () => {
  const dir = seedDir('fill-ws');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 fill-ws"]').click();
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15000 });

  const colors = await page.evaluate(() => {
    const view = document.querySelector('.pd-term-view') as HTMLElement | null;
    if (!view) return null;
    // xterm 的 theme.background 由 readTerminalTheme 讀 CSS var --bg 而來（WebGL canvas 上畫的
    // 是這個色、DOM 元素讀不到）；把 --bg 解析成 rgb 當期望值，驗證容器底色與其一致。
    const cssBg = getComputedStyle(view).getPropertyValue('--bg').trim();
    const probe = document.createElement('div');
    probe.style.color = cssBg;
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { view: getComputedStyle(view).backgroundColor, themeBg: expected };
  });
  expect(colors).not.toBeNull();
  // 容器不得是透明（透明＝露出主題底色形成留白框），且須與 xterm theme 背景同色
  expect(colors!.view).not.toBe('rgba(0, 0, 0, 0)');
  expect(colors!.view).toBe(colors!.themeBg);

  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
