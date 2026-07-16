// PTY↔xterm 尺寸自癒（dogfood：claude 展開時最下方被擋、滾不出來）：
// ConPTY 行數一旦與 xterm 漂移（resize 失敗被吞/任何原因），TUI 會把底部 UI 畫在不存在的列上。
// 修法＝自癒管線：renderer 每次 fit 都送尺寸、main 以「實際套用成功」的尺寸去重（失敗不記帳→自動重試）。
// 本測驗證：人為把 PTY 調成 rows+6（模擬漂移）→ 保持焦點並產生輸出 → ConPTY 行數自動回到與 xterm 一致。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pdheal-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 讓 shell 把 ConPTY 視窗高度寫進檔案（真實鏈路讀 ConPTY 認知的 rows）。 */
async function readConptyRows(page: Page, dir: string, tag: string): Promise<number> {
  await page.locator('.pd-term-view').first().click();
  await page.keyboard.type(`[Console]::WindowHeight | Set-Content h-${tag}.txt -Encoding Ascii`);
  await page.keyboard.press('Enter');
  let v = 0;
  await expect
    .poll(
      () => {
        try {
          v = Number.parseInt(readFileSync(join(dir, `h-${tag}.txt`), 'utf8').trim(), 10);
        } catch {
          v = 0;
        }
        return v;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  return v;
}

test('PTY 尺寸漂移後持續輸出即自癒（不必重新點擊，ConPTY rows 回到 xterm rows）', async () => {
  const dir = seedDir('heal-ws');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 heal-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2000); // shell 就緒 + 初次 fit 穩定

    const xtermRows = await page.evaluate(() => {
      const host = document.querySelector('.pd-term-view')?.firstElementChild as
        | (HTMLElement & { __pdTerm?: { rows: number } })
        | null;
      return host?.__pdTerm?.rows ?? 0;
    });
    expect(xtermRows).toBeGreaterThan(5);

    // 基準：ConPTY 與 xterm 一致
    expect(await readConptyRows(page, dir, 'base')).toBe(xtermRows);

    // 模擬漂移：直接把 PTY 調成 rows+6（xterm 不動）——等價於某次 resize 失敗後殘留的不同步
    await page.evaluate(async (extra) => {
      const w = (window as unknown as { polydesk: { store: { getState: () => Promise<{ workspaces: { id: string }[] }> }; pty: { list: (r: { wsId: string }) => Promise<{ termId: string }[]>; resize: (r: { termId: string; cols: number; rows: number }) => Promise<unknown> } } }).polydesk;
      const st = await w.store.getState();
      const terms = await w.pty.list({ wsId: st.workspaces[0].id });
      const host = document.querySelector('.pd-term-view')?.firstElementChild as
        | (HTMLElement & { __pdTerm?: { rows: number; cols: number } })
        | null;
      await w.pty.resize({ termId: terms[0].termId, cols: host!.__pdTerm!.cols, rows: host!.__pdTerm!.rows + extra });
    }, 6);
    // 不移動焦點；resize/SIGWINCH 或既有 workflow 的下一段輸出會讓 renderer 節流補送 xterm
    // 真實尺寸。若先用 shell 指令讀「漂移值」，該指令本身的 echo 就已觸發自癒，因此直接驗證終態。
    await page.waitForTimeout(800);

    expect(await readConptyRows(page, dir, 'healed')).toBe(xtermRows);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
