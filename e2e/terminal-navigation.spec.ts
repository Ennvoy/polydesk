// 終端機內容導覽軌：真 PowerShell 產生 scrollback → 每個非空白邏輯行顯示可跳節點 →
// 滑鼠點節點與 Alt+方向鍵都會移動 xterm viewport，不另建 transcript 或解析原始 ANSI bytes。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

interface NavigationState {
  viewportY: number;
  baseY: number;
  nodeCount: number;
}

async function navigationState(page: Page): Promise<NavigationState> {
  return page.evaluate(() => {
    const host = document.querySelector('.pd-term-xterm-host') as
      | (HTMLElement & { __pdTerm?: { buffer: { active: { viewportY: number; baseY: number } } } })
      | null;
    const buffer = host!.__pdTerm!.buffer.active;
    return {
      viewportY: buffer.viewportY,
      baseY: buffer.baseY,
      nodeCount: Number(host!.dataset.navigationNodeCount ?? 0),
    };
  });
}

async function ptyWrite(page: Page, data: string): Promise<void> {
  await page.evaluate(async (input) => {
    const api = (
      window as unknown as {
        polydesk: {
          store: { getState: () => Promise<{ workspaces: { id: string }[] }> };
          pty: { list: (r: { wsId: string }) => Promise<{ termId: string }[]>; write: (termId: string, data: string) => void };
        };
      }
    ).polydesk;
    const state = await api.store.getState();
    const terminals = await api.pty.list({ wsId: state.workspaces[0].id });
    api.pty.write(terminals[0].termId, input);
  }, data);
}

test('內容導覽節點可點擊跳轉，Alt+方向鍵可前後移動', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-term-navigation-'));
  const dir = join(root, 'navigation-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 navigation-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-xterm-host[data-initial-size-ready="true"]')).toBeVisible({ timeout: 15_000 });

    // 真 PowerShell 產生超過一屏的非空白邏輯行，迫使 xterm 建立 scrollback。
    await ptyWrite(page, '1..90 | ForEach-Object { "NAV_LINE_$_" }\r');
    await expect
      .poll(async () => {
        const state = await navigationState(page);
        return state.baseY > 0 ? state.nodeCount : 0;
      }, { timeout: 15_000 })
      .toBeGreaterThan(60);

    const rail = page.getByRole('navigation', { name: '終端機內容導覽' });
    await expect(rail).toBeVisible();
    const nodes = rail.locator('.pd-term-navigation-node');
    await expect.poll(() => nodes.count()).toBeGreaterThan(60);
    await expect(nodes.first()).toHaveAttribute('title', /.+/);

    const bottom = await navigationState(page);
    expect(bottom.viewportY).toBe(bottom.baseY);

    // 點最前面的節點：viewport 應離開底部，且該節點成為目前位置。
    await nodes.first().click();
    await expect.poll(async () => (await navigationState(page)).viewportY).toBeLessThan(bottom.baseY);
    await expect(nodes.first()).toHaveAttribute('aria-current', 'location');

    // 點擊後焦點會回 xterm；Alt+↓ 走自訂鍵盤導覽，前往下一個嚴格較後節點。
    const beforeKeyboard = (await navigationState(page)).viewportY;
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(async () => (await navigationState(page)).viewportY).toBeGreaterThan(beforeKeyboard);

    // 最後節點回到底部，證明 rail 的完整上下範圍都可達。
    await nodes.last().click();
    await expect.poll(async () => {
      const state = await navigationState(page);
      return state.baseY - state.viewportY;
    }).toBe(0);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
