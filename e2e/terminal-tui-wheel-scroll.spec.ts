// 使用者回報（2026-08-20）：終端機畫面沒辦法往上滾動、字都會被吃掉。回報者只用過 Claude 分頁。
//
// 假設：Claude Code 等 TUI 會開啟滑鼠追蹤（?1003 = 任何滑鼠事件都回報給程式）。一旦開啟，
// xterm 會把滾輪事件當成滑鼠回報送給 TUI，而不是拿來捲自己的 scrollback ——使用者因此
// 「滾也滾不回來」。此症狀早在 terminal-scroll-follow.spec.ts 的檔頭被記錄過，但當時只修了
// 另一半（輸出時 viewport 被凍住的孤兒旗標），滾輪被送走這半從未處理。
//
// 本測分三段釘住行為：(1) 未開滑鼠追蹤時滾輪必須能捲（基準線，確認測試本身有效）；
// (2) 開啟 ?1003 後滾輪是否仍能捲（回報的症狀）；(3) Shift+滾輪能否繞過（業界慣例的逃生口，
// 決定修法是「改預設行為」還是「只需把既有逃生口寫進使用說明」）。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

interface ViewState {
  viewportY: number;
  baseY: number;
  mouseEventsActive: boolean | null;
}

async function viewState(page: Page): Promise<ViewState> {
  return page.evaluate(() => {
    const host = document.querySelector('.pd-term-view')?.firstElementChild as
      | (HTMLElement & {
          __pdTerm?: {
            buffer: { active: { viewportY: number; baseY: number } };
            _core?: Record<string, unknown>;
          };
        })
      | null;
    const t = host!.__pdTerm!;
    return {
      viewportY: t.buffer.active.viewportY,
      baseY: t.buffer.active.baseY,
      mouseEventsActive: (() => {
        const core = t._core as Record<string, unknown> | undefined;
        if (!core) return null;
        for (const k of Object.keys(core)) {
          if (!/mouse/i.test(k)) continue;
          const svc = core[k] as { areMouseEventsActive?: boolean } | undefined;
          if (svc && typeof svc.areMouseEventsActive === 'boolean') return svc.areMouseEventsActive;
        }
        return null;
      })(),
    };
  });
}

async function ptyWrite(page: Page, data: string): Promise<void> {
  await page.evaluate(async (d) => {
    const w = (
      window as unknown as {
        polydesk: {
          store: { getState: () => Promise<{ workspaces: { id: string }[] }> };
          pty: { list: (r: { wsId: string }) => Promise<{ termId: string }[]>; write: (termId: string, data: string) => void };
        };
      }
    ).polydesk;
    const st = await w.store.getState();
    const terms = await w.pty.list({ wsId: st.workspaces[0].id });
    w.pty.write(terms[0].termId, d);
  }, data);
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector('.pd-term-view')?.firstElementChild as
      | (HTMLElement & { __pdTerm?: { scrollToBottom(): void } })
      | null;
    host!.__pdTerm!.scrollToBottom();
  });
}

/** 真實滾輪：hover 到 xterm 畫面上再滾，走與使用者相同的事件路徑。 */
async function wheelUp(page: Page, opts?: { shift?: boolean }): Promise<void> {
  const box = await page.locator('.pd-term-view .xterm-screen').first().boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  if (opts?.shift) await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -120); // Windows WHEEL_DELTA：真實滑鼠一格
  if (opts?.shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
}

test('TUI 開啟滑鼠追蹤（?1003）時，使用者仍應能用滾輪往上捲 scrollback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-tuiwheel-'));
  const dir = join(root, 'wheel-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 wheel-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);

    // 造 scrollback
    await ptyWrite(page, '1..120 | % { "line $_" }\r');
    await expect.poll(async () => (await viewState(page)).baseY, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    const atBottom = await viewState(page);
    expect(atBottom.viewportY).toBe(atBottom.baseY);

    // (1) 基準線：沒有 TUI 滑鼠追蹤時，滾輪必須捲得動
    await wheelUp(page);
    const plain = await viewState(page);
    console.log(`[基準線] 未開滑鼠追蹤：捲上去 ${plain.baseY - plain.viewportY} 行，mouseEventsActive=${plain.mouseEventsActive}`);
    expect(plain.baseY - plain.viewportY).toBeGreaterThan(0);

    // 回底部，然後讓 shell 送出滑鼠追蹤序列（模擬 Claude Code 啟動時做的事）
    await scrollToBottom(page);
    // 直接把 TUI 會送的序列餵給 xterm（ConPTY 會重新編碼 console API 的輸出，
    // 從 PowerShell 送不進來；滑鼠追蹤是 xterm 的內部狀態，由哪條路進去不影響滾輪行為）。
    await page.evaluate(() => {
      const host = document.querySelector('.pd-term-view')?.firstElementChild as
        | (HTMLElement & { __pdTerm?: { write(d: string): void } })
        | null;
      host!.__pdTerm!.write('[?1003h[?1006h');
    });
    await page.waitForTimeout(1_000);
    const tuiOn = await viewState(page);
    console.log(`[狀態] 送出 ?1003h 後 mouseEventsActive=${tuiOn.mouseEventsActive}`);
    expect(tuiOn.mouseEventsActive).toBe(true); // 前提：滑鼠追蹤真的開起來了

    await scrollToBottom(page);
    const beforeTuiWheel = await viewState(page);

    // (2) 回報的症狀：TUI 滑鼠追蹤開著時，滾輪還捲得動嗎
    await wheelUp(page);
    const tuiWheel = await viewState(page);
    console.log(`[症狀] 滑鼠追蹤開啟時滾輪：捲上去 ${tuiWheel.baseY - tuiWheel.viewportY} 行（0 = 滾不動＝重現 bug）`);

    // (3) 逃生口：Shift+滾輪能否繞過滑鼠追蹤
    await scrollToBottom(page);
    await wheelUp(page, { shift: true });
    const shiftWheel = await viewState(page);
    console.log(`[逃生口] Shift+滾輪：捲上去 ${shiftWheel.baseY - shiftWheel.viewportY} 行（>0 = 逃生口有效）`);

    // 斷言擺最後，讓上面三行診斷數據一定會印出來
    expect(beforeTuiWheel.viewportY).toBe(beforeTuiWheel.baseY);
    expect(tuiWheel.baseY - tuiWheel.viewportY).toBeGreaterThan(0); // 使用者必須捲得動
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
