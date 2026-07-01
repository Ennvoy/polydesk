// 貼上外部檔案（VSCode 風 Ctrl+V）：驗 preload 暴露 fileUtils.pathForFile + fs:importFiles 端到端
// 把工作區外的真實檔案（含中文名）複製進工作區，並讓檔案總管自動重整顯示。
// 註：clipboardData.files → webUtils.getPathForFile 那段需真實系統剪貼簿，屬人工 dogfood；
//     此處以真實外部路徑直呼 importFiles，覆蓋 preload 橋接 + IPC + fs + tree 重整整條鏈路。
import { test, expect } from '@playwright/test';
import { rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('貼上外部檔案：fileUtils 已暴露 + importFiles 複製進工作區並自動顯示', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj'); // 工作區根
  const extDir = makeSubDir(wsRoot, 'external'); // 工作區外（模擬系統剪貼簿來源）
  const src = join(extDir, '貼我.txt');
  writeFileSync(src, 'PASTED', 'utf8');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  const tree = page.locator('[role="tree"]');
  await expect(tree).toBeVisible();

  // preload 橋接（Electron 33：webUtils.getPathForFile 取代 File.path）+ IPC 端到端
  const result = await page.evaluate(async (source) => {
    const w = window as unknown as { polydesk: { fileUtils?: { pathForFile?: unknown }; store: { getState: () => Promise<{ workspaces: { id: string }[] }> }; fs: { importFiles: (r: unknown) => Promise<unknown> } } };
    const hasFileUtils = typeof w.polydesk.fileUtils?.pathForFile === 'function';
    const st = await w.polydesk.store.getState();
    const wsId = st.workspaces[0].id;
    const r = await w.polydesk.fs.importFiles({ wsId, destDir: '', sources: [source] });
    return { hasFileUtils, r };
  }, src);

  expect(result.hasFileUtils).toBe(true);
  const r = result.r as { imported?: number; names?: string[] };
  expect(r.imported).toBe(1);
  expect(r.names).toEqual(['貼我.txt']);

  // 真實落檔 + 檔案總管自動重整顯示（fs:change → loadDir）
  expect(existsSync(join(wsDir, '貼我.txt'))).toBe(true);
  await expect(tree.locator('[role="treeitem"][aria-label="貼我.txt"]')).toBeVisible();

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});

// 真實 Ctrl+V 全鏈：系統剪貼簿 → keydown → paste catcher（焦點在非可編輯的檔案樹）→ webUtils → importFiles。
// 這條把「使用者實際按 Ctrl+V」也自動化了（僅 Windows；Set-Clipboard 放真實檔案進系統剪貼簿）。
test('真實 Ctrl+V：非可編輯焦點下也能貼入外部檔案（paste catcher）', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  const extDir = makeSubDir(wsRoot, 'external');
  const src = join(extDir, 'paste-me.txt');
  writeFileSync(src, 'VIA-CTRL-V', 'utf8');

  // 放進系統剪貼簿（模擬在 Windows 檔案總管複製了這個檔）
  execSync(`Set-Clipboard -Path "${src}"`, { shell: 'powershell.exe' });

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  const tree = page.locator('[role="tree"]');
  await expect(tree).toBeVisible();
  await tree.click(); // 焦點落在檔案樹（非可編輯 div）— 正是先前貼不進去的情境

  await page.keyboard.press('Control+V'); // 真實 Ctrl+V → catcher → paste → 匯入

  await expect(tree.locator('[role="treeitem"][aria-label="paste-me.txt"]')).toBeVisible({ timeout: 5000 });
  expect(existsSync(join(wsDir, 'paste-me.txt'))).toBe(true);

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
