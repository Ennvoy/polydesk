// 編輯器剪貼簿 e2e（dogfood 回報：編輯器右鍵/Ctrl 複製貼上失效）。
// 病因有兩層，缺一不可，本檔守住兩層的回歸：
//   1. REQ-SEC-001 權限全拒讓 navigator.clipboard.readText 必失敗 → main 對「自家主視窗＋
//      clipboard-read/clipboard-sanitized-write」例外放行（renderer 本就有 clipboard IPC，不增攻擊面）。
//   2. monaco-editor 0.55 standalone 漏註冊 productService，Paste 命令進場即拋 unknown service
//      且被選單 action runner 吞掉（無聲失敗）→ monacoSetup 註冊 ProductServiceStub。
// Playwright/CDP 與 webContents.sendInputEvent() 在測試模式都不產生 before-input-event；
// 此處直接觸發該 Electron 事件，驗證 main → renderer → Monaco 貼上整條產品路徑。
// 剪貼簿衛生：測試會動真系統剪貼簿——先快照、finally 還原（同 terminal-clipboard.spec）。
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const readClipboard = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText());

/** 快照現有系統剪貼簿 → 放入測試文字；回傳還原函式（finally 呼叫，不污染使用者剪貼簿）。 */
async function seedClipboard(app: ElectronApplication, text: string): Promise<() => Promise<void>> {
  const prev = await readClipboard(app);
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
  return async () => {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), prev).catch(() => undefined);
  };
}

/** 建工作區＋開 note.md 進編輯器，回傳編輯器 locator。 */
async function openEditorWithFile(app: ElectronApplication, page: Page, dir: string): Promise<ReturnType<Page['locator']>> {
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label^="開啟工作區 "]').click();
  await page.locator('[role="tree"] [role="treeitem"][aria-label="note.md"]').click();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toContainText('COPYME_ALPHA', { timeout: 15000 });
  return editor;
}

const modelContent = (page: Page): Promise<string> =>
  page.evaluate(() => {
    // monacoSetup globalAPI:true → window.monaco 可用
    const models = (window as unknown as { monaco: { editor: { getModels(): { getValue(): string }[] } } }).monaco.editor.getModels();
    return models.map((m) => m.getValue()).join('\n---\n');
  });

/** 開編輯器右鍵選單並點指定項目（選單掛載/定位需要一拍，先等可見再點）。 */
async function clickContextMenuItem(page: Page, editor: ReturnType<Page['locator']>, label: RegExp): Promise<void> {
  await editor.click({ button: 'right' });
  await expect(page.locator('.monaco-menu').first()).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(300); // 選單定位穩定（過快點擊會落空，repro 實測）
  await page.locator('.monaco-menu .action-label', { hasText: label }).first().click();
}

test('複製：鍵盤 Ctrl+C 與右鍵選單 Copy 都寫進系統剪貼簿', async () => {
  const root = makeTempDir();
  const dir = makeSubDir(root, 'clipedit');
  writeFileSync(join(dir, 'note.md'), 'COPYME_ALPHA line one\nsecond line\n');
  const { app, page, userData } = await launchApp();
  let restore: (() => Promise<void>) | null = null;
  try {
    const editor = await openEditorWithFile(app, page, dir);
    restore = await seedClipboard(app, 'SENTINEL_BEFORE_COPY');

    // 鍵盤 Ctrl+C
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await expect.poll(() => readClipboard(app), { timeout: 8000, message: 'Ctrl+C 未寫入系統剪貼簿' }).toContain('COPYME_ALPHA');

    // 右鍵選單 Copy（先清成哨兵值再驗）
    await app.evaluate(({ clipboard }) => clipboard.writeText('SENTINEL_BEFORE_MENU_COPY'));
    await editor.click();
    await page.keyboard.press('Control+a');
    await clickContextMenuItem(page, editor, /^(Copy|複製)$/);
    await expect.poll(() => readClipboard(app), { timeout: 8000, message: '右鍵選單 Copy 未寫入系統剪貼簿' }).toContain('COPYME_ALPHA');
  } finally {
    await restore?.();
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});

test('貼上：右鍵選單 Paste 與 Ctrl+V 都貼進編輯器', async () => {
  const root = makeTempDir();
  const dir = makeSubDir(root, 'clipedit2');
  writeFileSync(join(dir, 'note.md'), 'COPYME_ALPHA line one\nsecond line\n');
  const { app, page, userData } = await launchApp();
  let restore: (() => Promise<void>) | null = null;
  try {
    const editor = await openEditorWithFile(app, page, dir);
    restore = await seedClipboard(app, 'PASTED_CONTEXTMENU_QQQ');

    // 右鍵選單 Paste（全選讓貼上取代，斷言乾淨）
    await editor.click();
    await page.keyboard.press('Control+a');
    await clickContextMenuItem(page, editor, /^(Paste|貼上)$/);
    await expect.poll(() => modelContent(page), { timeout: 8000, message: '右鍵選單 Paste 未貼進編輯器' }).toContain('PASTED_CONTEXTMENU_QQQ');

    // 觸發實體 Ctrl+V 會進入的 Electron 事件；不可用 webContents.paste() 直接跳到結果。
    await app.evaluate(({ clipboard }) => clipboard.writeText('PASTED_CTRL_V'));
    const editorInput = editor.getByRole('textbox', { name: 'Editor content' });
    await editor.locator('.view-lines').click();
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Control+a');
    const prevented = await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents;
      let wasPrevented = false;
      wc?.emit(
        'before-input-event',
        { preventDefault() { wasPrevented = true; } } as Electron.Event,
        { type: 'keyDown', control: true, meta: false, alt: false, shift: false, key: 'v' } as Electron.Input,
      );
      return wasPrevented;
    });
    expect(prevented, 'Monaco 有焦點時應取消 Electron 原始 Ctrl+V，避免選取跳到側欄').toBe(true);
    await expect.poll(() => modelContent(page), { timeout: 8000, message: 'Ctrl+V 未貼進編輯器' }).toContain('PASTED_CTRL_V');
    await expect(editorInput, '貼上後焦點應留在編輯器').toBeFocused();
  } finally {
    await restore?.();
    await app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
