// 迴歸：編輯器隱藏時點側欄檔案必須把編輯器叫回最前（偶發「點檔沒反應」病根群）。
// 對應修法：editorBus 派送隔離 + DockLayout reveal 無條件 setVisible/setActive/try-catch + openDiff 同掛。
// 兩條路徑都驗：①隱藏後開「新檔案」（EditorGroup 走完整開檔）②隱藏後點「已開過的檔案」
// （EditorGroup 早退只 setActiveKey——視覺變化完全依賴 reveal 處理器，最容易漏）。
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('編輯器隱藏時點檔案：自動顯示編輯器並開檔（含已開分頁再點）', async () => {
  const root = makeTempDir();
  const dir = makeSubDir(root, 'reveal-ws');
  writeFileSync(join(dir, 'a.md'), 'AAA_REVEAL alpha\n');
  writeFileSync(join(dir, 'b.md'), 'BBB_REVEAL beta\n');

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 reveal-ws"]').click();

  const editorToggle = page.locator('button[aria-label="切換編輯器顯示"]');
  const tabA = page.locator('[role="tab"][aria-label^="a.md"]');
  const tabB = page.locator('[role="tab"][aria-label^="b.md"]');
  // dockview 隱藏＝該 group 的 .dv-view 容器高度收 0 並拔掉 'visible' class（DOM 子樹保留、
  // Playwright toBeHidden 不適用）；以「有 a.md 分頁的隱藏 .dv-view」個數當確定性斷言。
  const hiddenEditorView = page.locator('.dv-view:not(.visible)', { has: tabA });

  // 基線：編輯器可見時開 a.md
  await page.locator('[role="tree"] [role="treeitem"][aria-label="a.md"]').click();
  await expect(tabA).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.monaco-editor').first()).toContainText('AAA_REVEAL', { timeout: 15000 });

  // ① 隱藏編輯器 → 點「新檔案」b.md → 編輯器自動叫回、分頁開啟、內容真的載入
  await editorToggle.click();
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  await expect(hiddenEditorView).toHaveCount(1);
  await page.locator('[role="tree"] [role="treeitem"][aria-label="b.md"]').click();
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(hiddenEditorView).toHaveCount(0);
  await expect(tabB).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.monaco-editor').first()).toContainText('BBB_REVEAL', { timeout: 15000 });

  // ② 再隱藏 → 點「已開過的檔案」a.md（EditorGroup 早退路徑）→ 仍必須叫回編輯器並切到 a.md
  await editorToggle.click();
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  await expect(hiddenEditorView).toHaveCount(1);
  await page.locator('[role="tree"] [role="treeitem"][aria-label="a.md"]').click();
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await expect(hiddenEditorView).toHaveCount(0);
  await expect(tabA).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.monaco-editor').first()).toContainText('AAA_REVEAL', { timeout: 15000 });

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});
