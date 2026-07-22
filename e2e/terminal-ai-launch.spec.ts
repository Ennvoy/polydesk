// AI CLI 快捷啟動：每個按鈕建立獨立終端機、套用易辨識名稱，並送出固定啟動命令。
// 測試以暫存 PATH 中的假 CLI 接住三條命令，不啟動外部 AI，避免登入狀態與模型額度影響回歸結果。
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

async function readTermBuffer(page: import('@playwright/test').Page, index: number): Promise<string | null> {
  return page.evaluate((termIndex) => {
    const host = document.querySelectorAll('[data-term-unicode]')[termIndex];
    const term = (host as unknown as {
      __pdTerm?: {
        buffer: {
          active: {
            length: number;
            getLine(y: number): { translateToString(trim?: boolean): string } | undefined;
          };
        };
      };
    })?.__pdTerm;
    if (!term) return null;
    let text = '';
    for (let y = 0; y < term.buffer.active.length; y += 1) {
      text += `${term.buffer.active.getLine(y)?.translateToString(true) ?? ''}\n`;
    }
    return text;
  }, index);
}

async function readTermCols(page: import('@playwright/test').Page, index: number): Promise<number | null> {
  return page.evaluate((termIndex) => {
    const host = document.querySelectorAll('[data-term-unicode]')[termIndex];
    return (host as unknown as { __pdTerm?: { cols: number } })?.__pdTerm?.cols ?? null;
  }, index);
}

test('Claude bypass / Codex / Agy 按鈕會各開終端機並送出對應命令', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-ai-launch-'));
  const dir = join(root, 'ai-launch-ws');
  const bin = join(root, 'bin');
  mkdirSync(dir, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'report-cols.js'),
    "process.stdout.write(`FAKE_CLAUDE_COLS:${process.stdout.columns ?? 0}\\r\\n`);\n",
    'utf8',
  );
  writeFileSync(
    join(bin, 'claude.cmd'),
    '@echo off\r\necho FAKE_CLAUDE_ARGS:%*\r\nnode "%~dp0report-cols.js"\r\n',
    'utf8',
  );
  writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\necho FAKE_CODEX_STARTED\r\n', 'utf8');
  writeFileSync(join(bin, 'agy.cmd'), '@echo off\r\necho FAKE_AGY_STARTED\r\n', 'utf8');

  const { app, page, userData } = await launchApp({
    env: { PATH: `${bin};${process.env.PATH ?? ''}` },
  });
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 ai-launch-ws"]').click();

  await page.getByRole('button', { name: '開啟 Claude bypass' }).click();
  await expect(page.locator('.pd-term-pane')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('[data-term-unicode]').nth(0)).toHaveAttribute('data-initial-size-ready', 'true');
  await expect
    .poll(() => readTermBuffer(page, 0), { timeout: 15000 })
    .toContain('FAKE_CLAUDE_ARGS:--dangerously-skip-permissions');
  const claudeBuffer = await readTermBuffer(page, 0);
  const claudeCols = await readTermCols(page, 0);
  expect(claudeCols).not.toBeNull();
  expect(claudeBuffer).toContain(`FAKE_CLAUDE_COLS:${claudeCols}`);

  // 啟動後再改版面寬度：xterm 必須重新 fit，後續 shell 程序看到的 ConPTY 欄數也要一致。
  // 這條會抓出「renderer 已改 cols，但 main resize 失敗後沒有重試」造成的靜止畫面永久跑版。
  await page.getByRole('button', { name: '切換工作區列顯示' }).click();
  await expect(page.getByRole('button', { name: '切換工作區列顯示' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => readTermCols(page, 0)).not.toBe(claudeCols);
  const resizedCols = await readTermCols(page, 0);
  expect(resizedCols).not.toBeNull();
  await page.locator('[data-term-unicode]').nth(0).click();
  await page.keyboard.type(`node "${join(bin, 'report-cols.js')}"`);
  await page.keyboard.press('Enter');
  await expect
    .poll(() => readTermBuffer(page, 0), { timeout: 15000 })
    .toContain(`FAKE_CLAUDE_COLS:${resizedCols}`);

  await page.getByRole('button', { name: '開啟 Codex' }).click();
  await expect(page.locator('.pd-term-pane')).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator('[data-term-unicode]').nth(1)).toHaveAttribute('data-initial-size-ready', 'true');
  await expect.poll(() => readTermBuffer(page, 1), { timeout: 15000 }).toContain('FAKE_CODEX_STARTED');
  await page.getByRole('button', { name: '開啟 Agy' }).click();
  await expect(page.locator('.pd-term-pane')).toHaveCount(3, { timeout: 15000 });
  await expect(page.locator('[data-term-unicode]').nth(2)).toHaveAttribute('data-initial-size-ready', 'true');
  await expect.poll(() => readTermBuffer(page, 2), { timeout: 15000 }).toContain('FAKE_AGY_STARTED');

  await expect(page.locator('.pd-term-pane-label')).toHaveText(['Claude bypass', 'Codex', 'Agy']);

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
