// REQ-TERM-009 真實鏈路驗證：真 PTY 輸出 keycap emoji（1️⃣）→ 顯示層 stripEnclosingKeycap →
// xterm buffer 只剩純數字、不含 U+20E3 圍框字元。
//
// 刻意讓 node（而非 PowerShell）產生 keycap：指令本身全 ASCII（用 String.fromCodePoint(0x31,0xFE0F,0x20E3)），
// 故不受 Windows cp950 console 編碼影響；node stdout 走 UTF-8 → node-pty UTF-8 解碼 → renderer onData →
// 本次修的 strip → term.write。整條真實、無 mock。
import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp, stubFolderPicker, addWorkspaceViaUI, makeTempDir, makeSubDir } from './electronApp';

const ENCLOSE = String.fromCodePoint(0x20e3); // U+20E3 combining enclosing keycap（未修時會殘留在 buffer）

// 讀「診斷 seam」暴露的 term 的整個 scrollback buffer 文字（真實 cell 內容，非 mock）。
async function readTermBuffer(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-term-unicode]');
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
    const buf = term.buffer.active;
    let text = '';
    for (let y = 0; y < buf.length; y++) text += (buf.getLine(y)?.translateToString(true) ?? '') + '\n';
    return text;
  });
}

test('REQ-TERM-009：真 PTY 輸出 keycap 1️⃣ → buffer 退化成純數字、無 U+20E3 圍框', async () => {
  const root = makeTempDir('pdkeycap-');
  const dir = makeSubDir(root, 'keycap-ws');
  const { app, page, userData } = await launchApp();
  await stubFolderPicker(app, [dir]);
  await addWorkspaceViaUI(page);
  await page.locator('button[aria-label="開啟工作區 keycap-ws"]').click();

  // 開終端機（real PTY, PowerShell）→ 等寬度表 seam 就緒＝term 已掛好 __pdTerm
  await page.locator('button[aria-label="新增終端機"]').click();
  const host = page.locator('[data-term-unicode="11"]').first();
  await expect(host).toBeAttached({ timeout: 15000 });

  // 聚焦終端機，送一行 node 指令：印出 PDKC + keycap(1️⃣) + END。錨點 PDKC…END 便於在 buffer 定位。
  await host.click();
  await page.keyboard.type(
    `node -e "process.stdout.write('PDKC'+String.fromCodePoint(0x31,0xFE0F,0x20E3)+'END')"`,
  );
  await page.keyboard.press('Enter');

  // 等 node 啟動並輸出。修好時 buffer 會出現連續的 "PDKC1END"（keycap 被 strip 成純數字 1）。
  // 若 strip 未生效，輸出會是 "PDKC1️⃣END"（中間夾 U+20E3），永遠湊不出連續 PDKC1END → poll 逾時失敗。
  await expect
    .poll(() => readTermBuffer(page), { timeout: 20000, message: '等 node 真 PTY 輸出並經 keycap 正規化' })
    .toContain('PDKC1END');

  // 硬斷言：整個 buffer 不得含實際 U+20E3 字元（指令回顯是 ASCII 的 "0x20E3"、不含實際字元，不會干擾）。
  const finalBuf = await readTermBuffer(page);
  expect(finalBuf).not.toBeNull();
  expect(finalBuf).not.toContain(ENCLOSE);

  await app.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});
