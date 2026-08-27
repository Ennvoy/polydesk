// 使用者回報（2026-08-20／08-21）：Claude 分頁捲不動、輸入中文吃字。
//
// 病根不在 renderer，而在 main 端 PTY 用的 Windows 內建 ConPTY（conhost）：
//  - TUI 送的 `?1000/1002/1003/1006h`（滑鼠追蹤）被 ConPTY 自己吃掉、不轉給終端機
//    ⇒ Claude 以為滑鼠模式開著，xterm 不知情，滾輪不會被編成回報送給 Claude；
//  - 終端機送回的 SGR 滑鼠回報（滾輪）也不穿透給 TUI。
// 這兩點都「只有真的經過 PTY」才測得到——terminal-tui-wheel-scroll.spec.ts 是把序列直接餵進 xterm，
// 繞過了 ConPTY，因此修好了 xterm 端卻沒碰到病根。
//
// 本測從 PowerShell（真 PTY 子程序）輸出 VT 序列，斷言它們真的抵達 xterm：
//  (1) `?1049h` → xterm 進 alternate buffer；`?1049l` → 回 normal。
//  (2) `?1003h ?1006h` → xterm mouse events active（TUI 的滑鼠追蹤要能被終端機看到，滾輪才送得對地方）。
// 對照組實測（2026-08-25，Win11 26200，node 直測 node-pty 四輪）：內建 ConPTY 下 (2) 必敗、
// **(1) 會通過**——alt-screen 本來就穿透。故真正抓得住病根的是 (2)，(1) 只是 alt buffer 切換的
// regression baseline，不可拿它單獨當「conpty.dll 有生效」的證據，拿掉 (2) 這支測試就會假綠。
// 反向（xterm→TUI 的滾輪 SGR 回報，即症狀的另一半）目前尚無自動化覆蓋，見檔尾 TODO。
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

interface TermState {
  bufferType: string;
  mouseEventsActive: boolean | null;
}

async function termState(page: Page): Promise<TermState> {
  return page.evaluate(() => {
    const host = document.querySelector('.pd-term-view')?.firstElementChild as
      | (HTMLElement & {
          __pdTerm?: {
            buffer: { active: { type: string } };
            _core?: Record<string, unknown>;
          };
        })
      | null;
    const t = host!.__pdTerm!;
    return {
      bufferType: t.buffer.active.type,
      mouseEventsActive: (() => {
        const core = t._core as Record<string, unknown> | undefined;
        if (!core) return null;
        for (const k of Object.keys(core)) {
          if (!/mouse/i.test(k)) continue;
          const svc = core[k] as { areMouseEventsActive?: boolean } | undefined;
          if (svc && typeof svc.areMouseEventsActive === 'boolean') return svc.areMouseEventsActive;
        }
        return null;
      })(),
    };
  });
}

async function ptyWrite(page: Page, data: string): Promise<void> {
  await page.evaluate(async (d) => {
    const w = (
      window as unknown as {
        polydesk: {
          store: { getState: () => Promise<{ workspaces: { id: string }[] }> };
          pty: { list: (r: { wsId: string }) => Promise<{ termId: string }[]>; write: (termId: string, data: string) => void };
        };
      }
    ).polydesk;
    const st = await w.store.getState();
    const terms = await w.pty.list({ wsId: st.workspaces[0].id });
    w.pty.write(terms[0].termId, d);
  }, data);
}

/**
 * 讓 PowerShell 子程序真的把 VT 序列寫到它的 console（經 ConPTY 轉出給 xterm）。
 * 每個元素是去掉 ESC 的 CSI 內文（如 '[?1049h'）；PowerShell 5.1 沒有 `e 轉義，故以 [char]27 組字串。
 */
function psEmit(seqs: string[]): string {
  const expr = seqs.map((q) => `[char]27 + '${q}'`).join(' + ');
  return `[Console]::Out.Write(${expr})` + String.fromCharCode(13);
}

test('PTY 子程序送的 alt-screen／滑鼠追蹤序列必須真的抵達 xterm（ConPTY 不可吞掉）', async () => {
  test.skip(process.platform !== 'win32', 'ConPTY 只存在於 Windows');
  const root = mkdtempSync(join(tmpdir(), 'pd-conpty-'));
  const dir = join(root, 'conpty-ws');
  mkdirSync(dir, { recursive: true });
  // 釘死後端：殼層若殘留 POLYDESK_CONPTY_DLL=0（排查對照組用）會讓本測紅在錯的理由上。
  const { app, page, userData } = await launchApp({ env: { POLYDESK_CONPTY_DLL: '1' } });
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 conpty-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-view .xterm-screen').first()).toBeVisible({ timeout: 15_000 });
    // 等 PowerShell 提示字元就緒（首屏 fit／chcp 注入完成）
    await page.waitForTimeout(3_000);

    const base = await termState(page);
    expect(base.bufferType).toBe('normal');
    console.log(`[基準] buffer=${base.bufferType} mouseEventsActive=${base.mouseEventsActive}`);

    // (1) alt screen：TUI 送 ?1049h 後，xterm 必須真的切到 alternate buffer
    await ptyWrite(page, psEmit(['[?1049h']));
    await expect.poll(async () => (await termState(page)).bufferType, { timeout: 10_000 }).toBe('alternate');
    console.log('[alt-screen] ?1049h 抵達 xterm：buffer=alternate');

    // (2) 滑鼠追蹤：TUI 送 ?1003h ?1006h 後，xterm 必須知道滑鼠模式已開（滾輪才會回報給 TUI 而非捲 scrollback）
    await ptyWrite(page, psEmit(['[?1003h', '[?1006h']));
    await expect.poll(async () => (await termState(page)).mouseEventsActive, { timeout: 10_000 }).toBe(true);
    console.log('[mouse] ?1003h/?1006h 抵達 xterm：mouseEventsActive=true');

    // 收尾：關滑鼠追蹤、離開 alt screen，xterm 要能回到 normal
    await ptyWrite(page, psEmit(['[?1003l', '[?1006l', '[?1049l']));
    await expect.poll(async () => (await termState(page)).bufferType, { timeout: 10_000 }).toBe('normal');
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// TODO（症狀的另一半，尚未自動化）：xterm→TUI 方向的滾輪 SGR 回報（`ESC[<64;x;yM`）是否真的送達子程序。
// 上面兩個斷言都是 TUI→xterm 方向；若日後 node-pty／conpty.dll 升版讓入向回報回歸壞掉，這支測試仍會全綠，
// 而 Claude 分頁會再次捲不動。要補的話需要子程序能回報自己讀到什麼（例如 PowerShell 迴圈讀 [Console]::In
// 並回顯字元碼），在 Windows 上容易 flaky，故本批先以本註解揭露缺口，不硬塞不穩的測試。
