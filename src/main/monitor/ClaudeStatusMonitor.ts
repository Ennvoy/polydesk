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
import { Notification, BrowserWindow } from 'electron';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { aggregateByTool, AI_TOOLS, matchWorkspace, type SessionStatus } from './claudeHookState';
import { readCodexSessions } from './codexRollout';
import { scanAiShellPids, type AiShellPids } from './aiProcessScan';
import { claudePaths } from '../claude/statusHooks';

/** 週期重算間隔（cheap：只讀已快取 sessions + pidsOf，不掃整機程序）。catches 關終端機→idle。 */
const DEFAULT_RECOMPUTE_MS = 3_000;
/** claude process 掃描節流（不必每次 recompute 都掃；掃描在背景跑、不卡住重算）。 */
const PROCESS_SCAN_MS = 8_000;
/** 強制補掃的最小間隔（新 session 看似沒 pid 時提早掃，加快「剛啟動→燈亮」；防連環 spawn）。 */
const FORCE_SCAN_MIN_MS = 3_000;

/** 兩 pid 集合是否相同（掃描結果沒變就不觸發重算）。 */
function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

type WorkspacesView = Pick<WorkspaceManager, 'list'>;
type PtyView = Pick<PtyManager, 'pidsOf'>;
type EmitFn = (payload: EventChannels['claude:status']) => void;

/** 待確認桌面通知（PE-2）；預設 Electron Notification，測試可注入。 */
type AwaitNotifier = (info: { wsId: string; name: string }) => void;
function defaultNotifyAwait(info: { wsId: string; name: string }): void {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'Claude 待確認',
      body: `工作區「${info.name}」的 Claude 需要你確認（點此回到 Polydesk）。`,
    });
    // 點通知 → 聚焦 Polydesk 視窗並切到該工作區（PE-2：通知可回跳）。
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('workspace:activate', { wsId: info.wsId });
    });
    n.show();
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
  /** claude/codex process 掃描（單一 spawn 一趟掃兩工具；工具值 null＝該輪失敗、保留上次快取）；測試可注入。 */
  scanPids?: () => Promise<AiShellPids | null>;
  /** 掃描節流間隔（測試用；預設 PROCESS_SCAN_MS）。 */
  processScanMs?: number;
  /** 強制補掃最小間隔（測試用；預設 FORCE_SCAN_MIN_MS）。 */
  forceScanMinMs?: number;
  watchFactory?: WatchFactory;
}

export class ClaudeStatusMonitor {
  /** 每工作區上次 emit 的狀態（去抖比對基準；預設 'idle'）。 */
  private readonly lastState = new Map<string, ClaudeState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: { close: () => void } | null = null;
  private started = false;
  /** 進行中的重算（single-flight）。 */
  private inFlight: Promise<void> | null = null;
  /** 跑中再被觸發時排定的補跑（多次觸發合流共用一輪，不丟 hook 事件）。 */
  private followUp: Promise<void> | null = null;

  private readonly statusDir: string;
  private readonly recomputeMs: number;
  private readonly notifyAwait: AwaitNotifier;
  private readonly readSessions: SessionReader;
  private readonly readCodex: SessionReader;
  private readonly scanPids: () => Promise<AiShellPids | null>;
  private readonly processScanMs: number;
  private readonly forceScanMinMs: number;
  private claudeShellPids = new Set<number>();
  private codexShellPids = new Set<number>();
  private lastScanAt = 0;
  /** 掃描 single-flight（in-flight 時重複要求共用同一趟）。 */
  private scanning: Promise<void> | null = null;
  /** 是否已成功掃過一次（冷啟動首輪等掃描完再聚合，避免首繪誤判全 idle）。 */
  private scannedOnce = false;
  /** 已看過的 sessionId（每個新 session 最多觸發一次強制補掃）。 */
  private readonly seenSessions = new Set<string>();
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
    this.scanPids = opts.scanPids ?? scanAiShellPids;
    this.processScanMs = opts.processScanMs ?? PROCESS_SCAN_MS;
    this.forceScanMinMs = opts.forceScanMinMs ?? FORCE_SCAN_MIN_MS;
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

  /**
   * 重算所有工作區狀態 → 變才 emit。single-flight＋補跑合流：一輪在跑時再被觸發，
   * 排一輪「跑完後補跑」並回傳它（多次觸發共用同一輪補跑）——不丟 hook 事件、await 者拿得到自己觸發的結果。
   */
  recompute(): Promise<void> {
    if (this.inFlight) {
      this.followUp ??= this.inFlight
        .catch(() => undefined)
        .then(() => {
          this.followUp = null;
          return this.recompute();
        });
      return this.followUp;
    }
    this.inFlight = this.runOnce().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * 單輪重算。process 掃描在背景跑、不卡住重算（忙碌機器上 PowerShell 掃描可達數秒；
   * 掃描結果變了會自動再重算一次）；只有冷啟動首輪等掃描完成，避免用空 pid 快取把首繪誤判成全 idle。
   * 掃描失敗保留上次快取（fail-open，防「掃描逾時→全部誤判 idle→徽章閃爍」）。
   */
  private async runOnce(): Promise<void> {
    const scan = this.maybeScanPids(false);
    if (scan && !this.scannedOnce) await scan; // 冷啟動首輪：等真實 pid 再聚合
    const now = Date.now();
    // claude（hook 狀態檔）+ codex（rollout 解析）兩來源並行讀、各自容錯。
    const [claudeSessions, codexSessions] = await Promise.all([
      this.readSessions().catch(() => [] as SessionStatus[]),
      this.readCodex().catch(() => [] as SessionStatus[]),
    ]);
    const sessions = [...claudeSessions, ...codexSessions];
    // per-tool idle 閘門：claude 要「Polydesk 終端機真的有 claude 子程序」（process 偵測，取代殘留猜測）；
    // codex 有 PTY 即可（其 sessions 由 rollout reader 已用 mtime gate 活躍度）。
    const isAlive = (wsId: string, tool: AiTool): boolean => {
      const ptyPids = this.pty.pidsOf(wsId);
      if (ptyPids.length === 0) return false;
      const shells = tool === 'claude' ? this.claudeShellPids : this.codexShellPids;
      return ptyPids.some((p) => shells.has(p));
    };
    // 新 session 但 pid 快取還沒它 → 強制補掃一次（加快「剛啟動 claude → 燈亮」；每 session 最多一次）。
    let wantForce = false;
    for (const s of sessions) {
      if (this.seenSessions.has(s.sessionId)) continue;
      this.seenSessions.add(s.sessionId);
      const wsId = matchWorkspace(s.cwd, this.workspaces.list());
      if (wsId && !isAlive(wsId, s.tool ?? 'claude')) wantForce = true;
    }
    if (this.seenSessions.size > 500) this.seenSessions.clear(); // 防無限長大（清掉只多掃一次，無害）
    if (wantForce) this.maybeScanPids(true);
    const byWsTool = aggregateByTool(this.workspaces.list(), sessions, isAlive, now);
    for (const [wsId, toolMap] of byWsTool) {
      for (const [tool, state] of toolMap) this.applyState(wsId, tool, state);
    }
  }

  /**
   * 節流啟動一趟背景 pid 掃描（single-flight）。回傳 in-flight promise（冷啟動可 await）；被節流回 null。
   * 掃描失敗（回 null）保留上次快取；掃描結果有變 → 觸發重算把新狀態推出去。
   */
  private maybeScanPids(force: boolean): Promise<void> | null {
    if (this.scanning) return this.scanning;
    const now = Date.now();
    const minGap = force ? Math.min(this.forceScanMinMs, this.processScanMs) : this.processScanMs;
    if (now - this.lastScanAt < minGap) return null;
    this.lastScanAt = now;
    this.scanning = this.scanPids()
      .catch(() => null)
      .then((r) => {
        if (!r) return;
        let changed = false;
        if (r.claude) {
          if (!sameSet(r.claude, this.claudeShellPids)) changed = true;
          this.claudeShellPids = r.claude;
          this.scannedOnce = true;
        }
        if (r.codex) {
          if (!sameSet(r.codex, this.codexShellPids)) changed = true;
          this.codexShellPids = r.codex;
          this.scannedOnce = true;
        }
        if (changed) void this.recompute();
      })
      .finally(() => {
        this.scanning = null;
      });
    return this.scanning;
  }

  /** 目前所有已知（工作區×工具）狀態快照（claude:states IPC；徽章掛載先拉現況再聽事件，重掛不丟燈）。 */
  snapshot(): EventChannels['claude:status'][] {
    const out: EventChannels['claude:status'][] = [];
    for (const [key, state] of this.lastState) {
      const i = key.indexOf('::');
      out.push({ wsId: key.slice(0, i), tool: key.slice(i + 2) as AiTool, status: { state } });
    }
    return out;
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
