// Claude 執行狀態監控（F-8，REQ-MON-001/002/005/006）。
// 改為「讀 Claude Code hooks 真實信號」：hook 腳本把每個 session 狀態（working/awaiting/done）寫成狀態檔，
// 本監控 watch 該目錄 + 便宜的週期重算（pidsOf 閘門，無 WMI）→ 聚合成每工作區 ClaudeState → 變才 emit。
//
// 取代舊的「猜程序樹（Get-CimInstance Win32_Process）」：那在忙碌系統常逾時、且無法分辨 claude 忙碌 vs 待確認。
// 精準四態（執行中/待確認/已停止/未啟動）來自 hooks（見 statusHooks.ts、claudeHookState.ts）。
// pidsOf 閘門（無 alive PTY → idle，cheap、非 WMI）保留：關掉終端機立即清掉 hook 殘留狀態。

import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { PtyManager } from '../pty/PtyManager';
import type { WorkspaceLifecycle } from '../workspace/workspaceLifecycle';
import type { EventChannels } from '../../shared/ipc';
import type { AiTool, ClaudeState } from '../../shared/types';
import { emit } from '../ipc/broadcast';
import { Notification } from 'electron';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { aggregateByTool, AI_TOOLS, type SessionStatus } from './claudeHookState';
import { readCodexSessions } from './codexRollout';
import { claudePaths } from '../claude/statusHooks';

/** 週期重算間隔（cheap：只讀已快取 sessions + pidsOf，不掃整機程序）。catches 關終端機→idle。 */
const DEFAULT_RECOMPUTE_MS = 3_000;

type WorkspacesView = Pick<WorkspaceManager, 'list'>;
type PtyView = Pick<PtyManager, 'pidsOf'>;
type EmitFn = (payload: EventChannels['claude:status']) => void;

/** 待確認桌面通知（PE-2）；預設 Electron Notification，測試可注入。 */
type AwaitNotifier = (info: { wsId: string; name: string }) => void;
function defaultNotifyAwait(info: { wsId: string; name: string }): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: 'Claude 待確認', body: `工作區「${info.name}」的 Claude 需要你確認。` }).show();
    }
  } catch {
    /* 通知失敗不致命 */
  }
}

/** 讀目前所有 session 狀態（預設掃 statusDir 的 *.json）；測試可注入。 */
type SessionReader = () => Promise<SessionStatus[]>;
/** watch 工廠（預設 chokidar）；測試可注入 no-op。回傳含 close()。 */
type WatchFactory = (dir: string, onChange: () => void) => { close: () => void };

export interface ClaudeStatusMonitorOptions {
  lifecycle?: WorkspaceLifecycle;
  statusDir?: string;
  recomputeMs?: number;
  notifyAwait?: AwaitNotifier;
  readSessions?: SessionReader;
  /** codex rollout 來源（預設掃 ~/.codex/sessions）；測試可注入。 */
  readCodex?: SessionReader;
  watchFactory?: WatchFactory;
}

export class ClaudeStatusMonitor {
  /** 每工作區上次 emit 的狀態（去抖比對基準；預設 'idle'）。 */
  private readonly lastState = new Map<string, ClaudeState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: { close: () => void } | null = null;
  private started = false;
  private recomputing = false;

  private readonly statusDir: string;
  private readonly recomputeMs: number;
  private readonly notifyAwait: AwaitNotifier;
  private readonly readSessions: SessionReader;
  private readonly readCodex: SessionReader;
  private readonly watchFactory: WatchFactory;

  constructor(
    private readonly workspaces: WorkspacesView,
    private readonly pty: PtyView,
    private readonly emitFn: EmitFn = (p) => emit('claude:status', p),
    opts: ClaudeStatusMonitorOptions = {},
  ) {
    this.statusDir = opts.statusDir ?? claudePaths().statusDir;
    this.recomputeMs = opts.recomputeMs ?? DEFAULT_RECOMPUTE_MS;
    this.notifyAwait = opts.notifyAwait ?? defaultNotifyAwait;
    this.readSessions = opts.readSessions ?? (() => this.defaultReadSessions());
    this.readCodex = opts.readCodex ?? (() => readCodexSessions());
    this.watchFactory = opts.watchFactory ?? defaultWatchFactory;
    opts.lifecycle?.register('monitor', (wsId) => {
      for (const tool of AI_TOOLS) this.lastState.delete(`${wsId}::${tool}`);
    });
  }

  /** 啟動（冪等）：建 statusDir + watch（hook 寫檔即時重算）+ 週期重算（catches 關終端機→idle）。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    void mkdir(this.statusDir, { recursive: true }).catch(() => undefined);
    this.watcher = this.watchFactory(this.statusDir, () => void this.recompute());
    this.timer = setInterval(() => void this.recompute(), this.recomputeMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.recompute();
  }

  /** 停止（app before-quit / 測試用）。 */
  stop(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* 關閉失敗不致命 */
      }
      this.watcher = null;
    }
  }

  /** 重算所有工作區狀態 → 變才 emit。single-flight 防重入。 */
  async recompute(): Promise<void> {
    if (this.recomputing) return;
    this.recomputing = true;
    try {
      const now = Date.now();
      // claude（hook 狀態檔）+ codex（rollout 解析）兩來源並行讀、各自容錯。
      const [claudeSessions, codexSessions] = await Promise.all([
        this.readSessions().catch(() => [] as SessionStatus[]),
        this.readCodex().catch(() => [] as SessionStatus[]),
      ]);
      const sessions = [...claudeSessions, ...codexSessions];
      const byWsTool = aggregateByTool(this.workspaces.list(), sessions, (id) => this.pty.pidsOf(id).length > 0, now);
      for (const [wsId, toolMap] of byWsTool) {
        for (const [tool, state] of toolMap) this.applyState(wsId, tool, state);
      }
    } finally {
      this.recomputing = false;
    }
  }

  /** 預設 session 讀取：掃 statusDir 的 *.json（壞檔/缺欄略過，永不丟例外）。 */
  private async defaultReadSessions(): Promise<SessionStatus[]> {
    let files: string[];
    try {
      files = await readdir(this.statusDir);
    } catch {
      return []; // 目錄不存在（尚無 claude 跑過）
    }
    const out: SessionStatus[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.statusDir, f), 'utf8');
        const j = JSON.parse(raw) as Partial<SessionStatus>;
        if (typeof j.cwd === 'string' && typeof j.state === 'string') {
          out.push({
            sessionId: typeof j.sessionId === 'string' ? j.sessionId : f,
            cwd: j.cwd,
            state: j.state as SessionStatus['state'],
            ts: typeof j.ts === 'number' ? j.ts : 0,
            tool: 'claude',
          });
        }
      } catch {
        /* 壞檔略過 */
      }
    }
    return out;
  }

  /** 狀態變才 emit（去抖，REQ-MON-006）；running→stopped-await（待確認）推桌面通知。 */
  private applyState(wsId: string, tool: AiTool, state: ClaudeState): void {
    const key = `${wsId}::${tool}`;
    const prev = this.lastState.get(key) ?? 'idle';
    if (prev === state) return;
    this.lastState.set(key, state);
    this.emitFn({ wsId, tool, status: { state } });
    if (prev !== 'stopped-await' && state === 'stopped-await') {
      const name = this.workspaces.list().find((w) => w.id === wsId)?.name ?? wsId;
      this.notifyAwait({ wsId, name });
    }
  }
}

/** 預設 chokidar watch（去抖 200ms 合併多檔事件）。 */
const defaultWatchFactory: WatchFactory = (dir, onChange) => {
  let t: ReturnType<typeof setTimeout> | null = null;
  const debounced = (): void => {
    if (t) clearTimeout(t);
    t = setTimeout(onChange, 200);
  };
  const w: FSWatcher = chokidar.watch(dir, { ignoreInitial: false, depth: 0 });
  w.on('add', debounced).on('change', debounced).on('unlink', debounced);
  return {
    close: () => {
      if (t) clearTimeout(t);
      void w.close();
    },
  };
};
