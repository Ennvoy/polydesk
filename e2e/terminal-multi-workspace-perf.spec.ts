// 四工作區同時高頻輸出的真 Electron 壓力回歸：模擬 Claude／Codex 串流，量 renderer frame
// p95、Electron renderer CPU 與記憶體。目的不是替 CLI 本身計費／連線，而是隔離 Polydesk 自己的
// PTY IPC、背景 xterm、WebGL 與 React 導覽更新成本。
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, stubFolderPicker, addWorkspaceViaUI } from './electronApp';

const WORKSPACE_COUNT = 4;
const SAMPLE_FRAMES = 120;
const FRAME_P95_BUDGET_MS = 50;
const RENDERER_CPU_BUDGET_PCT = 25;

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

async function startStream(page: Page, workspaceName: string): Promise<void> {
  await page.locator(`button[aria-label="開啟工作區 ${workspaceName}"]`).click();
  await page.locator('button[aria-label="新增終端機"]').click();
  await expect(page.locator('.pd-term-pane-body .pd-term-xterm-host[data-initial-size-ready="true"]')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async (name) => {
    const api = (
      window as unknown as {
        polydesk: {
          store: { getState: () => Promise<{ workspaces: { id: string; name: string }[] }> };
          pty: { list: (r: { wsId: string }) => Promise<{ termId: string }[]>; write: (termId: string, data: string) => void };
        };
      }
    ).polydesk;
    const state = await api.store.getState();
    const ws = state.workspaces.find((candidate) => candidate.name === name)!;
    const terminals = await api.pty.list({ wsId: ws.id });
    const command = '$i=0; while ($true) { $i++; Write-Output "AI_STREAM_$i abcdefghijklmnopqrstuvwxyz"; Start-Sleep -Milliseconds 4 }\r';
    api.pty.write(terminals[0].termId, command);
  }, workspaceName);
}

async function rendererMetrics(app: ElectronApplication): Promise<{ cpu: number; workingSetKb: number }> {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
  const renderer = metrics.find((metric) => metric.type === 'Tab');
  return { cpu: renderer?.cpu.percentCPUUsage ?? 0, workingSetKb: renderer?.memory.workingSetSize ?? 0 };
}

test('四工作區 AI 串流時 renderer 維持可互動且資源成本有上限', async () => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'pd-four-workspaces-'));
  const dirs = Array.from({ length: WORKSPACE_COUNT }, (_, index) => {
    const dir = join(root, `stream-${index + 1}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  });
  const { app, page, userData } = await launchApp();
  try {
    await stubFolderPicker(app, dirs);
    for (let index = 0; index < WORKSPACE_COUNT; index++) await addWorkspaceViaUI(page);
    for (let index = 0; index < WORKSPACE_COUNT; index++) await startStream(page, `stream-${index + 1}`);

    // 防假綠：四個背景 xterm 都必須真的收到大量輸出，不可只量到空 terminal。
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll('.pd-term-xterm-host')].filter((host) => {
              const term = (host as HTMLElement & { __pdTerm?: { buffer: { active: { baseY: number } } } }).__pdTerm;
              return (term?.buffer.active.baseY ?? 0) > 50;
            }).length,
          ),
        { timeout: 20_000 },
      )
      .toBe(WORKSPACE_COUNT);
    await page.waitForTimeout(1_000);
    await rendererMetrics(app); // CPU 首次呼叫只用來建立區間基準
    const frameGaps = await page.evaluate(async (count) => {
      const samples: number[] = [];
      let previous = performance.now();
      for (let i = 0; i < count; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        samples.push(now - previous);
        previous = now;
      }
      return samples;
    }, SAMPLE_FRAMES);
    const metrics = await rendererMetrics(app);
    const frameP95 = p95(frameGaps);
    const report = {
      workspaces: WORKSPACE_COUNT,
      activeStreams: WORKSPACE_COUNT,
      frameSamples: SAMPLE_FRAMES,
      frameP95Ms: Math.round(frameP95 * 10) / 10,
      rendererCpuPct: Math.round(metrics.cpu * 10) / 10,
      rendererWorkingSetMb: Math.round(metrics.workingSetKb / 102.4) / 10,
      budgets: { frameP95Ms: FRAME_P95_BUDGET_MS, rendererCpuPct: RENDERER_CPU_BUDGET_PCT },
    };
    const reportDir = process.env.PD_SHOT_DIR || join(process.cwd(), 'test-results');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'terminal-multi-workspace-perf-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`\n=== FOUR WORKSPACE TERMINAL PERF ===\n${JSON.stringify(report, null, 2)}`);

    expect(frameGaps).toHaveLength(SAMPLE_FRAMES);
    expect(frameP95, 'renderer frame p95').toBeLessThan(FRAME_P95_BUDGET_MS);
    expect(metrics.cpu, 'renderer CPU%').toBeLessThan(RENDERER_CPU_BUDGET_PCT);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
