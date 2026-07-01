// xlsx/xls 表格預覽：點試算表 → 渲染成表格（非 Monaco 二進位亂碼），儲存格值正確可見。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { launchApp, makeTempDir, makeSubDir, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

test('xlsx 開啟為表格預覽（非亂碼），儲存格值正確', async () => {
  const wsRoot = makeTempDir();
  const wsDir = makeSubDir(wsRoot, 'proj');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['姓名', '分數'], ['小明', 90]]), '成績');
  XLSX.writeFile(wb, join(wsDir, 'data.xlsx'));

  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [wsDir]);
  await addWorkspaceViaUI(page);

  // 點 xlsx → 表格預覽 pane（不是 Monaco）
  await page.locator('[role="tree"] [role="treeitem"][aria-label="data.xlsx"]').click();
  const sheet = page.locator('[role="group"][aria-label="試算表：data.xlsx"]');
  await expect(sheet).toBeVisible();

  // 儲存格值（含中文）正確渲染
  await expect(sheet.getByText('姓名', { exact: true })).toBeVisible();
  await expect(sheet.getByText('小明', { exact: true })).toBeVisible();
  await expect(sheet.getByText('90', { exact: true })).toBeVisible();
  // Excel 風欄標
  await expect(sheet.getByRole('columnheader', { name: 'A' })).toBeVisible();

  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
});
