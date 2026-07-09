// OS 檔案拖入檔案總管 → 複製進工作區（VS Code 慣例；重用 fs:importFiles 的匯入語意：
// 重名自動改名、資料夾遞迴）。用 CDP Input.dispatchDragEvent 帶真實檔案路徑模擬 Windows
// 檔案總管拖放——renderer 拿到 path-backed File，webUtils.getPathForFile 全鏈真實。
// 另驗：app 內部拖曳（樹列 dragstart 的自訂 MIME/text 純文字，無 'Files'）不得誤觸匯入。
import { test, expect, type Page } from '@playwright/test';
import { rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

/** 以 CDP 對座標 (x,y) 做一次帶真實檔案路徑的拖放（dragEnter→dragOver→drop）。 */
async function dropOsFilesAt(page: Page, x: number, y: number, files: string[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 }; // 1 = copy
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await cdp.detach();
}

test('OS 拖檔進檔案總管：空白區→複製到根；資料夾列→複製進該資料夾', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  mkdirSync(join(wsDir, 'sub'), { recursive: true });
  writeFileSync(join(wsDir, 'sub', 'keep.txt'), 'x', 'utf8'); // 讓 sub 非空、樹上可見
  const extDir = makeSubDir(wsRoot, 'external');
  const srcA = join(extDir, '拖我.txt');
  const srcB = join(extDir, 'into-sub.txt');
  writeFileSync(srcA, 'DROPPED-A', 'utf8');
  writeFileSync(srcB, 'DROPPED-B', 'utf8');

  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [wsDir]);
    await addWorkspaceViaUI(page);
    const tree = page.locator('[role="tree"]');
    await expect(tree).toBeVisible();
    await expect(tree.locator('[role="treeitem"][aria-label="sub"]')).toBeVisible();

    // 1) 拖到樹的空白區 → 複製到工作區根
    const tb = (await tree.boundingBox())!;
    await dropOsFilesAt(page, tb.x + tb.width / 2, tb.y + tb.height - 20, [srcA]);
    await expect(tree.locator('[role="treeitem"][aria-label="拖我.txt"]')).toBeVisible({ timeout: 5000 });
    expect(existsSync(join(wsDir, '拖我.txt'))).toBe(true);

    // 2) 拖到資料夾列 → 複製進該資料夾（自動展開顯示）
    const row = tree.locator('[role="treeitem"][aria-label="sub"]');
    const rb = (await row.boundingBox())!;
    await dropOsFilesAt(page, rb.x + rb.width / 2, rb.y + rb.height / 2, [srcB]);
    await expect(tree.locator('[role="treeitem"][aria-label="into-sub.txt"]')).toBeVisible({ timeout: 5000 });
    expect(existsSync(join(wsDir, 'sub', 'into-sub.txt'))).toBe(true);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(wsRoot, { recursive: true, force: true });
  }
});

test('app 內部拖曳（樹列→樹）不觸發匯入：無 Files 型別一律忽略', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  writeFileSync(join(wsDir, 'a.txt'), 'x', 'utf8');

  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, [wsDir]);
    await addWorkspaceViaUI(page);
    const tree = page.locator('[role="tree"]');
    await expect(tree.locator('[role="treeitem"][aria-label="a.txt"]')).toBeVisible();

    // 內部拖曳握手：dragstart（app 填自訂 MIME + text/plain）→ 拖回樹上 drop
    const src = tree.locator('[role="treeitem"][aria-label="a.txt"]');
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await src.dispatchEvent('dragstart', { dataTransfer: dt });
    await tree.dispatchEvent('dragover', { dataTransfer: dt });
    await tree.dispatchEvent('drop', { dataTransfer: dt });
    await src.dispatchEvent('dragend', { dataTransfer: dt });

    await page.waitForTimeout(800);
    // 不得出現複本（a copy.txt）、也不得跳「無法取得拖入檔案的路徑」錯誤
    expect(existsSync(join(wsDir, 'a copy.txt'))).toBe(false);
    await expect(page.getByText('無法取得拖入檔案的路徑')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(wsRoot, { recursive: true, force: true });
  }
});
