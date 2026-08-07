// 對話軸：終端機一旦辨識為 claude，軸就改以 claude 自己的 session transcript 為資料源，節點對齊
// 「訊息」，且點擊送出 Ctrl+O + `{` 定位。判準只看辨識結果、不看 buffer 型別——Claude Code 的 Ink
// TUI 跑在 normal buffer，早期版本要求 alternate screen 導致對話軸實際上從未接手，反而退回每行一
// 節點的行導覽軌。此規格把「normal buffer 也接手」釘住。
//
// 不啟動真 claude（要帳號、慢）：改用 stub 的 ai:conversation 快照，並在該工作區對應的
// ~/.claude/projects/<slug>/ 預先放一份 transcript。slug 來自 tmp 目錄，不會撞到使用者既有專案，
// 測後整個目錄刪除。
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI, makeTempDir, makeSubDir } from './electronApp';
import { claudeProjectSlug } from '../src/main/claude/sessionTranscript';

const jsonl = (value: unknown): string => `${JSON.stringify(value)}\n`;
const userLine = (text: string): string =>
  jsonl({ type: 'user', isSidechain: false, message: { content: [{ type: 'text', text }] } });
const assistantLine = (text: string): string =>
  jsonl({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'text', text }] } });
const toolResultLine = (): string =>
  jsonl({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } });

async function stubConversation(
  app: ElectronApplication,
  snapshot: {
    tool: 'claude' | 'codex' | null;
    sessionId?: string;
    nodes: { index: number; preview: string; promptsFromEnd?: number; matchText?: string }[];
    candidates?: { sessionId: string; nodes: { index: number; preview: string; matchText?: string }[] }[];
  },
): Promise<void> {
  await app.evaluate(({ ipcMain }, value) => {
    ipcMain.removeHandler('ai:conversation');
    ipcMain.handle('ai:conversation', () => value);
  }, snapshot);
}

/** 讓 PTY 真的吐出 escape sequence（不是寫進 stdin），xterm 才會實際切 buffer。 */
async function emitFromPty(page: Page, command: string): Promise<void> {
  await page.evaluate(async (input) => {
    const api = (
      window as unknown as {
        polydesk: {
          store: { getState: () => Promise<{ workspaces: { id: string }[] }> };
          pty: { list: (r: { wsId: string }) => Promise<{ termId: string }[]>; write: (termId: string, data: string) => void };
        };
      }
    ).polydesk;
    const state = await api.store.getState();
    const terminals = await api.pty.list({ wsId: state.workspaces[0].id });
    api.pty.write(terminals[0].termId, input);
  }, command);
}

/** 終端機實際可用版面：欄列數會直接反映字元格大小，rail 若吃掉寬度或改變行高必然變動。 */
async function terminalMetrics(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const host = document.querySelector('.pd-term-xterm-host') as HTMLElement & {
      __pdTerm?: { cols: number; rows: number };
    };
    const rect = host.getBoundingClientRect();
    const rowEl = document.querySelector('.xterm-rows > div') as HTMLElement | null;
    return {
      cols: host.__pdTerm!.cols,
      rows: host.__pdTerm!.rows,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      rowHeight: rowEl ? Math.round(rowEl.getBoundingClientRect().height * 100) / 100 : -1,
    };
  });
}

test('對話軸不改變終端機的可用版面與行距', async () => {
  const root = makeTempDir('pd-transcript-layout-');
  const dir = makeSubDir(root, 'layout-ws');
  const projectDir = join(homedir(), '.claude', 'projects', claudeProjectSlug(dir));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'e2e-session.jsonl'), userLine('提問') + assistantLine('回覆') + userLine('再問'));

  const { app, page } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 layout-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-xterm-host[data-initial-size-ready="true"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pd-term-navigation.is-messages')).toHaveCount(0);

    const before = await terminalMetrics(page);

    await stubConversation(app, {
      tool: 'claude',
      sessionId: 'e2e-session',
      nodes: [
        { index: 0, preview: '提問', promptsFromEnd: 1 },
        { index: 1, preview: '再問', promptsFromEnd: 0 },
      ],
    });

    // 一般輸出即可觸發重查；normal buffer 下對話軸就該接手，不必等 alternate screen。
    await emitFromPty(page, "Write-Output 'CLAUDE-READY'\r");
    await expect(page.locator('.pd-term-navigation.is-messages')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pd-term-navigation-node.is-message')).toHaveCount(2);

    // 軌的 18px 寬是版面一直保留的空槽，節點是絕對定位、不參與版面計算 → 欄列數、
    // 可用寬高、左緣與單列行高都必須一模一樣。
    expect(await terminalMetrics(page)).toEqual(before);
  } finally {
    await app.close();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('normal buffer 的 Claude 終端機改用對話軸，節點對齊訊息且點擊送出定位按鍵', async () => {
  const root = makeTempDir('pd-transcript-rail-');
  const dir = makeSubDir(root, 'transcript-ws');
  const projectDir = join(homedir(), '.claude', 'projects', claudeProjectSlug(dir));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'e2e-session.jsonl'),
    userLine('第一個提問') +
      assistantLine('第一個回覆') +
      toolResultLine() + // 工具回填不該變成節點
      userLine('第二個提問') +
      assistantLine('第二個回覆'),
  );

  const { app, page } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 transcript-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-xterm-host[data-initial-size-ready="true"]')).toBeVisible({ timeout: 15_000 });
    // 尚未辨識為 AI 工具的一般 shell 先確認不是對話軸模式。
    await expect(page.locator('.pd-term-navigation.is-messages')).toHaveCount(0);
    await stubConversation(app, {
      tool: 'claude',
      sessionId: 'e2e-session',
      nodes: [
        { index: 0, preview: '第一個提問', promptsFromEnd: 1 },
        { index: 1, preview: '第二個提問', promptsFromEnd: 0 },
      ],
    });

    // 記錄送往 PTY 的資料，稍後驗證點擊真的送出 Ctrl+O + `{`。
    await app.evaluate(({ ipcMain }) => {
      const sink: string[] = [];
      (globalThis as unknown as { __ptyWrites: string[] }).__ptyWrites = sink;
      ipcMain.on('pty:write', (_event, payload: { data: string }) => {
        sink.push(payload.data);
      });
    });

    // 真 PowerShell 輸出（不切 buffer，等同 Claude Code 的 Ink TUI）觸發重查 → 對話軸接手。
    await emitFromPty(page, "Write-Output 'CLAUDE-READY'\r");

    const rail = page.locator('.pd-term-navigation.is-messages');
    await expect(rail).toBeVisible({ timeout: 15_000 });
    // 只保留 2 則使用者提問；tool_result 與 Claude 回覆都不建立節點。
    await expect(rail).toHaveAttribute('data-message-node-count', '2');
    await expect(rail.locator('.pd-term-navigation-node.is-prompt')).toHaveCount(2);
    await expect(rail.locator('.pd-term-navigation-node.is-reply')).toHaveCount(0);
    await expect(rail.locator('.pd-term-navigation-node').first()).toHaveAttribute(
      'aria-label',
      '跳到第 1 則你的提問：第一個提問',
    );

    // 點第一則提問：它前面還有 1 個 user prompt（第二個提問）→ Ctrl+O 後送 1 次 `{`。
    // 斷言整條寫入序列而非最後一筆：xterm 取得焦點時也會送出自己的回報序列。
    const ptyWrites = (): Promise<string[]> =>
      app.evaluate(() => (globalThis as unknown as { __ptyWrites: string[] }).__ptyWrites);
    await rail.locator('.pd-term-navigation-node.is-prompt').first().click();
    await expect.poll(ptyWrites, { timeout: 5_000 }).toContain('\x0f{');

    // 最新那則之後沒有更多 prompt → 只送 Ctrl+O，不帶 `{`。
    await rail.locator('.pd-term-navigation-node').last().click();
    await expect.poll(ptyWrites, { timeout: 5_000 }).toContain('\x0f');

    // Claude session 結束（SessionEnd 刪掉狀態檔 → 辨識回 null）→ 立刻交還原本的行導覽軌。
    // 先 Ctrl+C 清掉輸入行：上面點擊送出的 `{` 進了 PowerShell 的命令列，會把接下來的指令
    // 吃成 script block（這正是 jumpToMessage 刻意不送 Enter 的理由——誤觸只留字元、不會執行）。
    await stubConversation(app, { tool: null, nodes: [] });
    await emitFromPty(page, '\x03');
    await expect(page.locator('.pd-term-navigation.is-messages')).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await app.close();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('Codex 對話軸只顯示能唯一配對到 scrollback 的使用者提問', async () => {
  const root = makeTempDir('pd-codex-rail-');
  const dir = makeSubDir(root, 'codex-rail-ws');
  const { app, page } = await launchApp();
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 codex-rail-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-xterm-host[data-initial-size-ready="true"]')).toBeVisible({ timeout: 15_000 });
    await stubConversation(app, {
      tool: 'codex',
      nodes: [],
      candidates: [
        {
          sessionId: 'codex-e2e',
          nodes: [
            { index: 0, preview: '第一個提問', matchText: '第一個提問' },
            { index: 1, preview: '第二個提問', matchText: '第二個提問' },
            { index: 2, preview: '已離開畫面的提問', matchText: '已離開畫面的提問' },
          ],
        },
      ],
    });
    await emitFromPty(
      page,
      "Write-Output '› 第一個提問'; 1..35 | ForEach-Object { Write-Output ('MODEL-' + $_) }; Write-Output '› 第二個提問'\r",
    );

    const rail = page.locator('.pd-term-navigation.is-messages');
    await expect(rail).toHaveAttribute('data-message-node-count', '2', { timeout: 15_000 });
    await expect(rail.locator('.pd-term-navigation-node.is-prompt')).toHaveCount(2);
    await expect(rail.locator('.pd-term-navigation-node').first()).toHaveAttribute('aria-label', '跳到你的提問：第一個提問');
    await rail.locator('.pd-term-navigation-node').first().click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = document.querySelector('.pd-term-xterm-host') as HTMLElement & {
            __pdTerm?: { buffer: { active: { viewportY: number } } };
          };
          return host.__pdTerm?.buffer.active.viewportY ?? -1;
        }),
      )
      .toBeLessThan(5);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('手動啟動 Codex 相容程序時走真 process、rollout 與 terminal 綁定鏈路', async () => {
  const root = makeTempDir('pd-codex-real-chain-');
  const dir = makeSubDir(root, 'codex-real-chain-ws');
  const codexHome = makeTempDir('pd-codex-home-');
  const date = new Date();
  const sessionDir = join(
    codexHome,
    'sessions',
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  );
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'rollout-e2e-real-chain.jsonl'),
    jsonl({
      type: 'session_meta',
      payload: { id: 'codex-real-chain', cwd: dir, source: 'cli', originator: 'codex-tui' },
    }) +
      jsonl({ type: 'event_msg', payload: { type: 'user_message', message: '真鏈路第一問' } }) +
      jsonl({ type: 'event_msg', payload: { type: 'agent_message', message: '模型輸出不應成為節點' } }) +
      jsonl({ type: 'event_msg', payload: { type: 'user_message', message: '真鏈路第二問' } }),
  );
  // process scanner 以 node.exe command line 的 codex.js 辨識官方 npm TUI；此 shim 只模擬程序形狀與畫面輸出。
  writeFileSync(
    join(dir, 'codex.js'),
    [
      "console.log('› 真鏈路第一問');",
      "console.log('模型輸出不應成為節點');",
      "console.log('› 真鏈路第二問');",
      "setInterval(() => console.log('模型心跳'), 1000);",
    ].join('\n'),
  );

  const { app, page } = await launchApp({ env: { CODEX_HOME: codexHome } });
  try {
    await stubFolderPicker(app, [dir]);
    await addWorkspaceViaUI(page);
    await page.locator('button[aria-label="開啟工作區 codex-real-chain-ws"]').click();
    await page.locator('button[aria-label="新增終端機"]').click();
    await expect(page.locator('.pd-term-xterm-host[data-initial-size-ready="true"]')).toBeVisible({ timeout: 15_000 });

    await emitFromPty(page, 'node .\\codex.js\r');

    const rail = page.locator('.pd-term-navigation.is-messages');
    await expect(rail).toHaveAttribute('data-message-node-count', '2', { timeout: 30_000 });
    await expect(rail.locator('.pd-term-navigation-node.is-prompt')).toHaveCount(2);
    await expect(rail.locator('.pd-term-navigation-node.is-reply')).toHaveCount(0);
    await expect(rail.locator('.pd-term-navigation-node').first()).toHaveAttribute(
      'aria-label',
      '跳到你的提問：真鏈路第一問',
    );
  } finally {
    await app.close();
    rmSync(codexHome, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
