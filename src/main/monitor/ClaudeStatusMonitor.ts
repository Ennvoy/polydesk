// Claude 狀態監控（F-8：REQ-MON-001/002/004/005/006、REQ-E2E-005）。唯讀觀察、不控制 Claude。
//
// 每輪：單次批量列舉一次全機程序表（昂貴的 powershell spawn 只跑一次），再以同一份快照逐工作區跑
// 純樹演算法分類三態（資源有界 REQ-MON-006）：
//   無 claude → 'idle'；有 claude 且其下仍有子程序 → 'running'；有 claude 但無子程序（停在提示等待）
//   → 'stopped-await'。狀態與上次比較，**變才 emit('claude:status')**（去抖、降載 REQ-MON-006）。
//
// 自適應 + 有界輪詢（REQ-MON-006）：間隔 = clamp(base*ceil(n/k), base, max)，n=工作區數。
//   n=0 → base（不退化成 0ms 忙迴圈，F-8-A5）；n 極大 → 夾在硬上限（不退化成近乎不更新）。
//
// single-flight + 逾時 backstop（F-8-A4）：下一輪只在上一輪「完成後」才排程（禁裸 setInterval 重入）；
//   注入式 lister 若 hang，withTimeout backstop 放棄該輪、沿用上次狀態、不阻塞迴圈（真實 lister 另有
//   自帶子程序逾時 kill）。

import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { PtyManager } from '../pty/PtyManager';
import type { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import type { EventChannels } from '../../shared/ipc';
import type { ClaudeState } from '../../shared/types';
import { DEFAULT_BACKGROUND_POLL_MS } from '../../shared/constants';
import { emit } from '../ipc/broadcast';
import { matchClaude, defaultProcessLister, type ProcessLister } from './processProbe';

/** 輪詢間隔自適應：每 SCALE_K 個工作區 ×base。 */
const DEFAULT_SCALE_K = 4;
/** 輪詢間隔硬上限（REQ-MON-006，避免 n 極大時近乎不更新）。 */
const DEFAULT_MAX_POLL_MS = 60_000;
/** 單輪 lister 逾時 backstop（> 真實 lister 自帶逾時，僅防注入式/壞掉的 lister hang）。 */
const DEFAULT_PROBE_BACKSTOP_MS = 12_000;

export interface ClaudeStatusMonitorOptions {
  /** teardown 協調：註冊 'monitor' concern，移除工作區時清該 ws 狀態快取。 */
  lifecycle?: WorkspaceLifecycle;
  basePollMs?: number;
  maxPollMs?: number;
  scaleK?: number;
  probeTimeoutMs?: number;
}

/** 只用到的工作區/PTY 介面（縮窄依賴，測試可注入 fake；對齊真實 WorkspaceManager/PtyManager 簽名）。 */
type WorkspacesView = Pick<WorkspaceManager, 'list'>;
type PtyView = Pick<PtyManager, 'pidsOf'>;

type EmitFn = (payload: EventChannels['claude:status']) => void;

/**
 * 自適應輪詢間隔（純函式、可單測）：clamp(base*ceil(n/k), base, max)。
 * n<=0 / 非有限 → 視為 0 → factor=1 → 回 base（絕不回 0ms，F-8-A5）。
 */
export function computePollInterval(
  n: number,
  basePollMs: number,
  maxPollMs: number,
  scaleK: number,
): number {
  const safeN = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const k = scaleK > 0 ? scaleK : 1;
  const factor = Math.max(1, Math.ceil(safeN / k));
  const raw = basePollMs * factor;
  return Math.min(maxPollMs, Math.max(basePollMs, raw));
}

/** 三態分類（REQ-MON-001/002）。 */
export function classifyClaude(claudePids: readonly number[], hasActiveChildren: boolean): ClaudeState {
  if (claudePids.length === 0) return 'idle';
  return hasActiveChildren ? 'running' : 'stopped-await';
}

export class ClaudeStatusMonitor {
  /** 每工作區上次 emit 的狀態（去抖比對基準；預設視為 'idle'＝renderer 徽章預設）。 */
  private readonly lastState = new Map<string, ClaudeState>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private inFlight = false;

  private readonly basePollMs: number;
  private readonly maxPollMs: number;
  private readonly scaleK: number;
  private readonly probeTimeoutMs: number;

  constructor(
    private readonly workspaces: WorkspacesView,
    private readonly pty: PtyView,
    private readonly emitFn: EmitFn = (p) => emit('claude:status', p),
    private readonly lister: ProcessLister = defaultProcessLister,
    opts: ClaudeStatusMonitorOptions = {},
  ) {
    this.basePollMs = opts.basePollMs ?? DEFAULT_BACKGROUND_POLL_MS;
    this.maxPollMs = opts.maxPollMs ?? DEFAULT_MAX_POLL_MS;
    this.scaleK = opts.scaleK ?? DEFAULT_SCALE_K;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? DEFAULT_PROBE_BACKSTOP_MS;
    opts.lifecycle?.register('monitor', (wsId) => {
      this.lastState.delete(wsId);
    });
  }

  /** 啟動輪詢（冪等）。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleNext(0);
  }

  /** 停止輪詢（app before-quit / 測試用）。 */
  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** 一輪探測：單次列舉 → 同快照逐工作區分類 → 變才 emit。下一輪只在本輪完成後排程（single-flight）。 */
  private async tick(): Promise<void> {
    if (this.inFlight) return; // 防衛：正常流程不會重入（僅完成後排程）
    this.inFlight = true;
    try {
      const processes = await this.withTimeout(this.lister(), this.probeTimeoutMs);
      if (this.started && processes) {
        for (const ws of this.workspaces.list()) {
          const rootPids = this.pty.pidsOf(ws.id);
          const { claudePids, hasActiveChildren } = matchClaude(rootPids, processes);
          this.applyState(ws.id, classifyClaude(claudePids, hasActiveChildren), claudePids[0]);
        }
      }
      // processes === null（逾時）或 lister reject → 降級沿用上次狀態，不 emit、不崩潰。
    } catch {
      /* lister 例外：隔離，不讓背景監控打斷 main / 中止迴圈（REQ-NFR-002） */
    } finally {
      this.inFlight = false;
      if (this.started) this.scheduleNext(this.computeInterval(this.workspaces.list().length));
    }
  }

  /** 狀態變才 emit（去抖，REQ-MON-006）；基準預設 'idle'（對齊 renderer 徽章預設，首輪 idle 不空打）。 */
  private applyState(wsId: string, state: ClaudeState, pid: number | undefined): void {
    const prev = this.lastState.get(wsId) ?? 'idle';
    if (prev === state) return;
    this.lastState.set(wsId, state);
    this.emitFn({
      wsId,
      status: pid !== undefined ? { state, pid } : { state },
    });
  }

  private computeInterval(n: number): number {
    return computePollInterval(n, this.basePollMs, this.maxPollMs, this.scaleK);
  }

  /** 包逾時 backstop：逾時/reject 一律解析 null（呼叫端降級），不阻塞迴圈（F-8-A4）。 */
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, ms);
      if (typeof t.unref === 'function') t.unref();
      p.then(
        (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          resolve(v);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          resolve(null);
        },
      );
    });
  }
}
