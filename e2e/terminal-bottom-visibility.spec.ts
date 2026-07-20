// 終端機底列可視性回歸（dogfood：claude 展開 Shell details 底部被截斷的排查產物）：
// 三方對賬「xterm rows ↔ ConPTY rows ↔ DOM 可視高度」，防 fit 幾何/尺寸同步回歸。
// 注意：TUI 動態區高度超過終端機 rows 時的底部截斷是 Claude Code（Ink）自身行為——
// 已實測（29 rows 截斷、59 rows 完整，PTY bytes 內根本沒有底部 UI），非 Polydesk 顯示層問題。
// 本測守住 Polydesk 這端的不變量：只要 bytes 有送來，最後一列一定畫在可視範圍內。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

function seedDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pdbotv-'));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Geo {
  rows: number;
  viewportY: number;
  baseY: number;
  cellH: number | null;
  screenTop: number | null;
  viewBottom: number | null;
  lastLine: string;
}

async function measure(page: Page): Promise<Geo> {
  return page.evaluate(() => {
    const view = document.querySelector('.pd-term-view') as HTMLElement | null;
    const host = view?.firstElementChild as
      | (HTMLElement & { __pdTerm?: import('@xterm/xterm').Terminal })
      | null;
    const term = host?.__pdTerm ?? null;
    const screen = (view?.querySelector('.xterm-screen') ?? null) as HTMLElement | null;
    const core = term
      ? (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height: number } } } } } })._core
      : null;
    const b = term?.buffer.active;
    return {
      rows: term?.rows ?? 0,
      viewportY: b?.viewportY ?? -1,
      baseY: b?.baseY ?? -1,
      cellH: core?._renderService?.dimensions?.css?.cell?.height ?? null,
      screenTop: screen ? screen.getBoundingClientRect().top : null,
      viewBottom: view ? view.getBoundingClientRect().bottom : null,
      lastLine:
        term && b ? (b.getLine(b.viewportY + term.rows - 1)?.translateToString(true) ?? '') : '',
    };
  });
}

test('終端機底列可視性：xterm/ConPTY/DOM 三方一致，填滿整屏後最後一列可見', async () => {
  const dir = seedDir('botv-ws');
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 botv-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500); // shell 就緒 + 初次 fit + 字型載入穩定

    const base = await measure(page);
    expect(base.rows).toBeGreaterThan(5);

    // ConPTY 認知的 rows（真實鏈路：shell 寫檔讀回）
    await page.locator('.pd-term-view').first().click();
    await page.keyboard.type('[Console]::WindowHeight | Set-Content rows.txt -Encoding Ascii');
    await page.keyboard.press('Enter');
    let conptyRows = 0;
    await expect
      .poll(
        () => {
          try {
            conptyRows = Number.parseInt(readFileSync(join(dir, 'rows.txt'), 'utf8').trim(), 10);
          } catch {
            conptyRows = 0;
          }
          return conptyRows;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    expect(conptyRows, 'ConPTY rows 應與 xterm rows 一致（漂移＝TUI 底部畫在不存在的列）').toBe(base.rows);

    // ANSI 逐列定位填滿整屏（不觸發捲動），最後一列補 <<BOTTOM>> 標記
    await page.keyboard.type(
      `$e=[char]27; $h=[Console]::WindowHeight; [Console]::Write("$e[2J"); 1..$h | % { [Console]::Write("$e[$($_);1HROW-$_") }; [Console]::Write("$e[$($h);12H<<BOTTOM>>")`,
    );
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    const g = await measure(page);
    expect(g.viewportY, '填屏後 viewport 應貼底').toBe(g.baseY);
    // 填屏指令結束後 shell 會再印一行 prompt（捲動一行）：BOTTOM 標記落在倒數第二列、prompt 佔最後一列
    const tail = await page.evaluate(() => {
      const host = document.querySelector('.pd-term-view')?.firstElementChild as
        | (HTMLElement & { __pdTerm?: import('@xterm/xterm').Terminal })
        | null;
      const term = host?.__pdTerm;
      if (!term) return [] as string[];
      const b = term.buffer.active;
      const out: string[] = [];
      for (let i = Math.max(0, term.rows - 3); i < term.rows; i++) {
        out.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '');
      }
      return out;
    });
    expect(tail.join('\n'), '可視畫面尾端應含 BOTTOM 標記（沒被裁掉/捲丟）').toContain('<<BOTTOM>>');
    // DOM 幾何：最後一列的像素底界必須落在終端機面板可視範圍內（否則被 CSS 裁掉、看得到 buffer 看不到畫面）
    expect(g.cellH).not.toBeNull();
    expect(g.screenTop).not.toBeNull();
    expect(g.viewBottom).not.toBeNull();
    const lastRowBottom = (g.screenTop as number) + g.rows * (g.cellH as number);
    expect(lastRowBottom, `最後一列 bottom(${lastRowBottom}) 應 ≤ 面板可視底界(${g.viewBottom})`).toBeLessThanOrEqual(
      (g.viewBottom as number) + 1,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
