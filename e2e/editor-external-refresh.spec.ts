// 編輯器外部更新與分頁選單：精準／coarse fs 事件、工作區隔離、dirty 批次取消／捨棄。
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('外部變更即時對帳，右鍵關閉全部只處理目前工作區且尊重取消', async () => {
  const root = makeTempDir('pd-editor-refresh-');
  const dirA = makeSubDir(root, 'editor-a');
  const dirB = makeSubDir(root, 'editor-b');
  const precisePath = join(dirA, 'precise.txt');
  const coarsePath = join(dirA, 'coarse.txt');
  writeFileSync(join(dirA, 'dirty.txt'), 'DIRTY_BASE\n');
  writeFileSync(precisePath, 'PRECISE_OLD\n');
  writeFileSync(coarsePath, 'COARSE_OLD\n');
  writeFileSync(join(dirB, 'hidden.txt'), 'HIDDEN_WORKSPACE\n');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dirA, dirB]);
  await addWorkspaceViaUI(page);
  await addWorkspaceViaUI(page);

  // 先在 B 留一個開啟分頁，後續確認 A 的「關閉全部」不會跨工作區。
  await page.locator('button[aria-label="開啟工作區 editor-b"]').click();
  await page.locator('[role="treeitem"][aria-label="hidden.txt"]').click();
  await expect(page.locator('[role="tab"][aria-label^="hidden.txt"]')).toBeVisible();

  await page.locator('button[aria-label="開啟工作區 editor-a"]').click();
  for (const name of ['dirty.txt', 'precise.txt', 'coarse.txt']) {
    await page.locator(`[role="treeitem"][aria-label="${name}"]`).click();
    await expect(page.locator(`[role="tab"][aria-label^="${name}"]`)).toBeVisible();
  }

  // 精準 change：乾淨分頁不需關閉重開，Monaco 立即載入新磁碟內容。
  await page.locator('[role="tab"][aria-label^="precise.txt"]').click();
  writeFileSync(precisePath, 'PRECISE_NEW\n');
  await expect(page.locator('.monaco-editor').first()).toContainText('PRECISE_NEW', { timeout: 15000 });

  // coarse path=''：即使沒有檔名，仍逐一讀取該工作區已開文字分頁並與快照對帳。
  await page.locator('[role="tab"][aria-label^="coarse.txt"]').click();
  const workspaceId = await page.evaluate(async () => {
    const api = window as Window & {
      polydesk: { workspace: { list: () => Promise<Array<{ id: string; name: string }>> } };
    };
    return (await api.polydesk.workspace.list()).find((workspace) => workspace.name === 'editor-a')?.id ?? '';
  });
  expect(workspaceId).not.toBe('');
  await app.evaluate(({ BrowserWindow }, { wsId, file }) => {
    const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    fs.writeFileSync(file, 'COARSE_NEW\n', 'utf8');
    // 寫入後同一個 main-process turn 立即只送根事件，讓 coarse 對帳先於 chokidar 的精準事件啟動。
    BrowserWindow.getAllWindows()[0]?.webContents.send('fs:change', { wsId, path: '', kind: 'change' });
  }, { wsId: workspaceId, file: coarsePath });
  await expect(page.locator('.monaco-editor').first()).toContainText('COARSE_NEW', { timeout: 15000 });

  // dirty 分頁排在批次第一個：Cancel 應立即中止，三個 visible 分頁都保留。
  const dirtyTab = page.locator('[role="tab"][aria-label^="dirty.txt"]');
  await dirtyTab.click();
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('LOCAL_EDIT');
  const preciseTab = page.locator('[role="tab"][aria-label^="precise.txt"]');
  await preciseTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '關閉全部' }).click();
  await page.locator('button[aria-label="取消"]').click();
  await expect(page.locator('.pd-editor-tab')).toHaveCount(3);

  // 再執行一次並捨棄 dirty：只關閉 A 的 visible tabs，B 的 hidden tab 仍保留。
  await preciseTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '關閉全部' }).click();
  await page.locator('button[aria-label="不儲存並關閉"]').click();
  await expect(page.getByText('尚未開啟檔案')).toBeVisible();
  await page.locator('button[aria-label="開啟工作區 editor-b"]').click();
  await expect(page.locator('[role="tab"][aria-label^="hidden.txt"]')).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toContainText('HIDDEN_WORKSPACE');

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});
