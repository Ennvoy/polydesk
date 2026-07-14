// 輸出跟捲自癒（dogfood：claude 內點「1 shell」展開 Shell details，終端機沒跟著捲到底、
// 輸入框/狀態列消失在畫面下方，且 claude 開滑鼠追蹤（?1003）滾輪被送走、使用者滾也滾不回來）。
//
// 病根：xterm 6 內部 isUserScrolling 旗標可能在「viewport 明明在底部」時被遺留成 true
// （選取拖曳自動捲動、resize/reflow 直接調 ydisp 幾何回底都不碰旗標）；而 xterm 所有清旗標
// 的路徑都掛著 ybase !== ydisp 守門 → 旗標成孤兒後，下一波大量輸出（TUI 展開重繪）就把
// viewport 凍在原地。鍵盤輸入會意外自癒（echo 捲動開出落差後、下一鍵觸發 scrollToBottom），
// 故本測全程 pty.write 直灌、不碰鍵盤——對齊 dogfood「純滑鼠點擊展開」的發病路徑。
// 修法＝renderer 自癒不變量：「寫入前在底部 ⇒ 寫入後仍在底部」（TerminalView repinIfDrifted）；
// 寫入前不在底部（使用者真的在讀 scrollback）則完全不干預。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

interface ViewState {
  viewportY: number;
  baseY: number;
  isUserScrolling: boolean | null;
}

async function viewState(page: Page): Promise<ViewState> {
  return page.evaluate(() => {
    const host = document.querySelector('.pd-term-view')?.firstElementChild as
      | (HTMLElement & {
          __pdTerm?: {
            buffer: { active: { viewportY: number; baseY: number } };
            _core?: { _bufferService?: { isUserScrolling?: boolean } };
          };
        })
      | null;
    const t = host!.__pdTerm!;
    return {
      viewportY: t.buffer.active.viewportY,
      baseY: t.buffer.active.baseY,
      isUserScrolling: t._core?._bufferService?.isUserScrolling ?? null,
    };
  });
}

/** 直灌 PTY（繞過鍵盤，避免 keydown 路徑的意外自癒污染實驗）。 */
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

test('孤兒 isUserScrolling 旗標下大量輸出，viewport 仍跟到底（展開不再吃掉底部）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-scrollfollow-'));
  const dir = join(root, 'scroll-ws');
  mkdirSync(dir, { recursive: true });
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 scroll-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000); // shell 就緒 + 初次 fit 穩定

    // 先製造 scrollback（baseY > 0），確認釘在底部。
    await ptyWrite(page, '1..80 | % { "line $_" }\r');
    await expect.poll(async () => (await viewState(page)).baseY, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    const before = await viewState(page);
    expect(before.viewportY).toBe(before.baseY); // 前提：使用者在底部

    // 模擬 dogfood 的旗標腐化：isUserScrolling 被遺留成 true 而 viewport 仍在底部
    // （等價「選取自動捲動/reflow 幾何回底但旗標沒清」的孤兒態；xterm 對此無任何清除路徑）。
    await page.evaluate(() => {
      const host = document.querySelector('.pd-term-view')?.firstElementChild as
        | (HTMLElement & { __pdTerm?: { _core?: { _bufferService?: { isUserScrolling: boolean } } } })
        | null;
      host!.__pdTerm!._core!._bufferService!.isUserScrolling = true;
    });

    // 再直灌一波超過一屏的輸出（等價 claude 展開 Shell details 的重繪外溢；全程無鍵盤）。
    await ptyWrite(page, '1..60 | % { "spill $_" }\r');
    await expect
      .poll(
        async () => {
          const s = await viewState(page);
          return s.baseY > before.baseY ? s.baseY - s.viewportY : -1; // 等輸出真的開始捲了才比
        },
        { timeout: 15_000 },
      )
      .toBe(0); // viewport 必須跟到底＝底部（提示符/最後輸出）看得到

    // 自癒須連孤兒旗標一起清掉（走 scrollToBottom → scrollLines 正路），不留下一次發病的火種。
    await page.waitForTimeout(500);
    const after = await viewState(page);
    expect(after.viewportY).toBe(after.baseY);
    expect(after.isUserScrolling).toBe(false);

    // 對照組：使用者真的捲上去讀 scrollback 時，輸出不得把人拉回底部。
    await page.evaluate(() => {
      const host = document.querySelector('.pd-term-view')?.firstElementChild as
        | (HTMLElement & { __pdTerm?: { scrollLines(n: number): void } })
        | null;
      host!.__pdTerm!.scrollLines(-10);
    });
    await expect
      .poll(async () => {
        const s = await viewState(page);
        return s.baseY - s.viewportY;
      }, { timeout: 5_000 })
      .toBeGreaterThan(0);
    await ptyWrite(page, '1..30 | % { "more $_" }\r');
    await page.waitForTimeout(2_000);
    const reading = await viewState(page);
    expect(reading.baseY - reading.viewportY).toBeGreaterThan(0); // 沒被拉回底部
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
