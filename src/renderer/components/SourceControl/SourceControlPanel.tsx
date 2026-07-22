// 原始碼控制面板（REQ-SCM-001~009、REQ-MON-003、REQ-E2E-003）。
// 讀 activeWorkspace → git:snapshot；非 repo → git init；變更樹 stage/unstage；commit/push/pull；
// 分支切換/建立；歷史；stash。點檔開 monaco diff。操作進行中顯示「進行中」、失敗顯示明確錯誤。
// 全用既有 pd-* class + var(--*) token + scm.css；每互動元素具 aria-label 與微狀態。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../../ipc/client';
import { useAppState } from '../../state/appStore';
import { dialog } from '../Dialogs/host';
import { editorBus } from '../../state/editorBus';
import { appStore } from '../../state/appStore';
import { loadGitSnapshot } from '../../state/gitSnapshot';
import { WorktreePanel } from '../Worktree/WorktreePanel';
import { PublishGitHubDialog } from './PublishGitHubDialog';
import { CreateWorktreeDialog } from '../Worktree/CreateWorktreeDialog';
import { parseWorktreeConflict, resolveJumpTarget } from '../Worktree/worktreeModel';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';
import type { GitStatus, GitChange, GitLogEntry, GitLogRef, AiEngine, GitPushErrorCode } from '../../../shared/types';
import { DEFAULT_BACKGROUND_POLL_MS, FETCH_COOLDOWN_MS } from '../../../shared/constants';
import { shouldAutoFetch } from './fetchCooldown';
import { computeGitGraph, type GitGraphRow } from './gitGraph';

type Tab = 'changes' | 'history' | 'branches' | 'worktree';

// ── commit 線圖渲染常數 ──
const GRAPH_LANE_W = 14;
const GRAPH_ROW_H = 48; // === scm.css .pd-scm-logrow height；務必同步（線圖列高＝SVG 高才不斷線）
const GRAPH_DOT_R = 4;
// lane 色盤（深/淺主題皆可讀的中飽和色）；色彩索引取模循環。
const GRAPH_COLORS = ['#4aa3ff', '#f78c6b', '#c792ea', '#7fd1b9', '#ffcb6b', '#f07178', '#82aaff', '#c3e88d'];
const graphColor = (c: number): string => GRAPH_COLORS[((c % GRAPH_COLORS.length) + GRAPH_COLORS.length) % GRAPH_COLORS.length];

/** 單列 commit 線圖（SVG）：through 直線、in 收斂、out 分岔，節點圓點落在 commitLane。 */
function GitGraphCell({ row, width }: { row: GitGraphRow; width: number }): React.JSX.Element {
  const h = GRAPH_ROW_H;
  const cx = (lane: number): number => GRAPH_LANE_W / 2 + lane * GRAPH_LANE_W;
  return (
    <svg className="pd-scm-graph" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true">
      {row.segments.map((s, i) => {
        const col = graphColor(s.color);
        if (s.kind === 'through') {
          return <line key={i} x1={cx(s.from)} y1={0} x2={cx(s.from)} y2={h} stroke={col} strokeWidth={1.6} />;
        }
        if (s.kind === 'in') {
          // 上緣(from) → 節點(to, 中央)，以 bezier 平滑收斂。
          return (
            <path
              key={i}
              d={`M ${cx(s.from)} 0 C ${cx(s.from)} ${h * 0.4}, ${cx(s.to)} ${h * 0.1}, ${cx(s.to)} ${h / 2}`}
              stroke={col}
              strokeWidth={1.6}
              fill="none"
            />
          );
        }
        // out：節點(from, 中央) → 下緣(to)
        return (
          <path
            key={i}
            d={`M ${cx(s.from)} ${h / 2} C ${cx(s.from)} ${h * 0.9}, ${cx(s.to)} ${h * 0.6}, ${cx(s.to)} ${h}`}
            stroke={col}
            strokeWidth={1.6}
            fill="none"
          />
        );
      })}
      <circle
        cx={cx(row.commitLane)}
        cy={h / 2}
        r={GRAPH_DOT_R}
        fill={graphColor(row.color)}
        stroke="var(--bg)"
        strokeWidth={2}
      />
    </svg>
  );
}

// ── commit ref 徽章（本地/遠端分支位置、tag，like VSCode Graph）──
const REF_GLYPH: Record<Exclude<GitLogRef['kind'], 'remote'>, string> = { local: '⎇', tag: '◈', detached: '⌖' };
const REF_KIND_LABEL: Record<GitLogRef['kind'], string> = { local: '本地分支', remote: '遠端分支', tag: '標籤', detached: '分離 HEAD' };
const refLabel = (r: GitLogRef): string => `${REF_KIND_LABEL[r.kind]} ${r.name}${r.head && r.kind === 'local' ? '（HEAD）' : ''}`;

/** 固定尺寸的 outline cloud；遠端 ref 不顯示文字，以免擠壓 commit 主旨。 */
function RemoteRefIcon(): React.JSX.Element {
  return (
    <svg className="pd-scm-ref-cloud" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h.79a4.5 4.5 0 1 1 1 9Z" />
    </svg>
  );
}

/** commit 列尾端的 ref 徽章列：HEAD 所在分支 accent 實底、遠端虛線框、tag/分離 HEAD 各有記號。 */
function RefBadges({ refs }: { refs: GitLogRef[] }): React.JSX.Element {
  return (
    <span className="pd-scm-refs">
      {refs.map((r) => (
        <span
          key={`${r.kind}:${r.name}`}
          className={`pd-scm-ref is-${r.kind}${r.head ? ' is-head' : ''}`}
          title={refLabel(r)}
          aria-label={refLabel(r)}
        >
          {r.kind === 'remote' ? (
            <RemoteRefIcon />
          ) : (
            <>
              <span aria-hidden="true">{REF_GLYPH[r.kind]}</span>
              {r.name}
            </>
          )}
        </span>
      ))}
    </span>
  );
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : '未知錯誤';
}

const STATUS_LABEL: Record<GitChange['status'], string> = {
  M: '修改',
  A: '新增',
  D: '刪除',
  R: '更名',
  U: '衝突',
  '?': '未追蹤',
};

function StatusBadge({ s }: { s: GitChange['status'] }): React.JSX.Element {
  return (
    <span className={`pd-scm-badge is-${s === '?' ? 'untracked' : s.toLowerCase()}`} title={STATUS_LABEL[s]}>
      {s === '?' ? 'U' : s}
    </span>
  );
}

function nOrNA(n: number | null): string {
  return n === null ? 'N/A' : String(n);
}

/** PE-4：切工作區自動 fetch 的冷卻時計——放模組層，面板卸載重掛不歸零（避免切視圖就重置冷卻）。 */
const autoFetchAt = new Map<string, number>();

/** SCM 畫面需要關心的 Git 狀態是否相同；HEAD 納入才能偵測外部 commit/pull。 */
function sameGitStatus(a: GitStatus, b: GitStatus): boolean {
  return (
    a.isRepo === b.isRepo &&
    a.head === b.head &&
    a.branch === b.branch &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.changedCount === b.changedCount &&
    a.detached === b.detached
  );
}

export function SourceControlPanel(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState();
  const wsId = activeWorkspaceId;
  const wsPath = workspaces.find((w) => w.id === wsId)?.path ?? '';

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false); // PE-4 取回遠端狀態中
  const [fetchHint, setFetchHint] = useState<string | null>(null); // PE-4 手動 fetch 失敗小字提示（非錯誤橫幅）
  const [message, setMessage] = useState('');
  const [genBusy, setGenBusy] = useState(false); // ✨ 智慧產生進行中（與 commit busy 分離，不互卡）
  const [engine, setEngine] = useState<AiEngine>('claude');
  const [tab, setTab] = useState<Tab>('changes');
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [branches, setBranches] = useState<{ list: string[]; current: string }>({ list: [], current: '' });
  const [hover, setHover] = useState<{ c: GitLogEntry; top: number; left: number } | null>(null); // PE-1 hover 卡
  const [commitMenu, setCommitMenu] = useState<{ c: GitLogEntry; x: number; y: number } | null>(null); // PE-1 右鍵選單
  const [changeMenu, setChangeMenu] = useState<{ c: GitChange; x: number; y: number } | null>(null); // 變更檔右鍵選單
  const [expanded, setExpanded] = useState<string | null>(null); // PE-1 展開檔案清單的 commit hash
  const [cFiles, setCFiles] = useState<Record<string, { path: string; status: string }[]>>({}); // commit→檔案清單快取
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // hover 延遲關閉計時器（滑入卡片可取消）
  const statusRef = useRef<GitStatus | null>(null);

  // 世代號取消 stale 載入：大 repo 的 git status/changes 各要 ~1.5-2s 且 git 走 serial queue。快速連切
  // 工作區時，若不取消，切到最新工作區還得等前面每個 stale 載入跑完、且 stale 結果會回頭覆蓋當前 →
  // 面板卡在 loading。每次 refresh 遞增 gen，await 回來後 gen 不是最新就丟棄（不 setState、不搶 loading）。
  const loadGen = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const gen = ++loadGen.current;
    if (!wsId) {
      setStatus(null);
      statusRef.current = null;
      setChanges([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadGitSnapshot(wsId);
      if (gen !== loadGen.current) return; // 期間又切了工作區：丟棄 stale
      statusRef.current = snapshot.status;
      setStatus(snapshot.status);
      setChanges(snapshot.status.isRepo ? snapshot.changes : []);
    } catch (e) {
      if (gen === loadGen.current) setError(errText(e));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // PE-4：事件驅動 fetch（拍板不背景輪詢）——只更新 remote-tracking ref，behind（未拉取數）才跟得上遠端。
  // 非 repo／無 remote 不觸發；自動路徑（切工作區）失敗靜默，手動路徑（⟳）顯示小字提示；成功後 refresh 補數字。
  const fetchRemote = useCallback(
    async (manual: boolean): Promise<void> => {
      if (!wsId) return;
      try {
        const st = statusRef.current;
        if (!st) return;
        if (!st.isRepo || st.hasRemote === false) return;
        if (!manual && !shouldAutoFetch(autoFetchAt, wsId, Date.now(), FETCH_COOLDOWN_MS)) return;
        setFetching(true);
        const r = await ipc.git.fetch({ wsId });
        if ('error' in r) {
          if (manual) setFetchHint(`取回失敗：${r.error}`);
        } else {
          setFetchHint(null);
          await refresh();
        }
      } catch (e) {
        if (manual) setFetchHint(`取回失敗：${errText(e)}`);
      } finally {
        setFetching(false);
      }
    },
    [wsId, refresh],
  );

  // 工作區切換 → 回變更分頁並刷新。防抖 120ms：快速連切只載入「最終停留」的工作區，中間掠過的
  // 不發 git 載入 → 不堆積 serial queue（實測連切 5 個大 repo 的 git status 會累積到 ~10s）。
  // 刷新後順帶自動 fetch（PE-4；同 wsId 60s 冷卻，連切不狂觸網）。
  useEffect(() => {
    setTab('changes');
    const t = setTimeout(() => void refresh().then(() => fetchRemote(false)), 120);
    return () => clearTimeout(t);
  }, [refresh, fetchRemote]);

  // 掛載時讀回持久化的「智慧產生引擎」設定。
  useEffect(() => {
    void ipc.store
      .getState()
      .then((s) => {
        if (s.aiCommit?.engine) setEngine(s.aiCommit.engine);
      })
      .catch(() => undefined);
  }, []);

  // REQ-MON-005：訂閱該工作區檔案系統變動 → 去抖自動刷新 git 狀態（工作樹變動即反映，不自設 timer/輪詢）。
  // 用 fs:change（FileWatcher 真會發；舊版誤訂從不觸發的 git:statusUpdate → 背景刷新靜默失效）。
  useEffect(() => {
    if (!wsId || !status?.isRepo) return undefined;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = ipc.events.fs.change((p) => {
      if (p.wsId !== wsId) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => void refresh(), 300); // 去抖：多檔變動合併成一次刷新
    });
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [wsId, status?.isRepo, refresh]);

  // 整合終端／外部工具的 Git 操作多半只修改 .git（一般 FileWatcher 刻意忽略），fs:change 收不到。
  // SCM 面板掛載且視窗可見時，以低頻 status-only 探測；狀態真的改變才做完整 refresh。
  // recursive timeout 保證前一輪未完成時不重疊，大 repo 不會堆積 git serial queue。
  useEffect(() => {
    if (!wsId || !status?.isRepo) return undefined;
    let stopped = false;
    let checking = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (): void => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void check(), DEFAULT_BACKGROUND_POLL_MS);
    };
    const check = async (): Promise<void> => {
      if (stopped || checking) return;
      if (document.visibilityState !== 'visible') {
        schedule();
        return;
      }
      checking = true;
      try {
        const next = await loadGitSnapshot(wsId);
        const current = statusRef.current;
        if (!stopped && current && !sameGitStatus(current, next.status)) {
          statusRef.current = next.status;
          setStatus(next.status);
          setChanges(next.status.isRepo ? next.changes : []);
        }
      } catch {
        // 背景探測失敗不覆蓋面板既有資料；使用者手動刷新時仍會看到正式錯誤。
      } finally {
        checking = false;
        schedule();
      }
    };
    const wake = (): void => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        timer = null;
        void check();
      }
    };

    schedule();
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [wsId, status?.isRepo, refresh]);

  // 右鍵選單（commit / 變更檔）— 點外 / Esc 關閉。
  useEffect(() => {
    if (!commitMenu && !changeMenu) return undefined;
    const close = (): void => {
      setCommitMenu(null);
      setChangeMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [commitMenu, changeMenu]);

  // 切到歷史/分支頁時載入對應資料。
  useEffect(() => {
    if (!wsId || !status?.isRepo) return;
    if (tab === 'history') {
      void ipc.git
        .log({ wsId, limit: 50 })
        .then(setLog)
        .catch((e) => setError(errText(e)));
    } else if (tab === 'branches') {
      void ipc.git
        .branch({ wsId, op: 'list' })
        .then((r) => {
          if ('branches' in r) setBranches({ list: r.branches, current: r.current });
        })
        .catch((e) => setError(errText(e)));
    }
  }, [tab, wsId, status?.isRepo, changes]);

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onInit = (): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      await ipc.git.init({ wsId });
      await refresh();
    });

  const onStage = (path: string, staged: boolean): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      await ipc.git.stage({ wsId, paths: [path], staged });
      await refresh();
    });

  const onStageAll = (staged: boolean, paths: string[]): Promise<void> =>
    run(async () => {
      if (!wsId || paths.length === 0) return;
      await ipc.git.stage({ wsId, paths, staged });
      await refresh();
    });

  const onCommit = (): Promise<void> =>
    run(async () => {
      if (!wsId || !message.trim()) return;
      const res = await ipc.git.commit({ wsId, message });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setMessage('');
      await refresh();
    });

  // ✨ 智慧產生 commit 訊息：後端取 staged diff → 選定引擎產生 → 回填訊息框（只回填、不自動 commit）。
  const onGenerateMsg = useCallback(async (): Promise<void> => {
    if (!wsId) return;
    setGenBusy(true);
    setError(null);
    try {
      const r = await ipc.ai.generateCommitMessage({ wsId });
      if ('error' in r) setError(r.error);
      else setMessage(r.message);
    } catch (e) {
      setError(errText(e));
    } finally {
      setGenBusy(false);
    }
  }, [wsId]);

  const onEngineChange = useCallback((next: AiEngine): void => {
    setEngine(next);
    void ipc.store.setAiCommit({ cfg: { engine: next } }).catch(() => undefined);
  }, []);

  // push 錯誤碼 → 人話前綴（DF-12；比照 CloneRepositoryDialog 的 code 分流慣例）。
  const pushErrorText = (r: { error: string; code: GitPushErrorCode }): string => {
    const prefix =
      r.code === 'no-remote'
        ? '尚未設定遠端（remote）。可用同步列的「發佈到 GitHub」建立遠端 repo 並直接推送。'
        : r.code === 'remote-not-found'
          ? 'GitHub 上找不到 remote 指向的 repository（可能尚未建立、已改名或無權限）。'
          : r.code === 'auth'
            ? '認證失敗。請確認 Git Credential Manager 或 SSH 金鑰可用。'
            : r.code === 'network'
              ? '網路連線失敗。請確認網路、VPN 或代理伺服器設定。'
              : '';
    return prefix ? `${prefix}\n${r.error}` : r.error;
  };

  const onPush = (): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      const r = await ipc.git.push({ wsId });
      if ('error' in r) setError(pushErrorText(r));
      else await refresh();
    });

  // 發佈到 GitHub（DF-12）：無 remote 時同步列的主要動作；對話框關閉後刷新（成功＝origin 已設、已推送）。
  const onPublish = async (): Promise<void> => {
    if (!wsId) return;
    const wsName = workspaces.find((w) => w.id === wsId)?.name ?? '';
    await dialog.open((close) => (
      <PublishGitHubDialog wsId={wsId} wsName={wsName} onClose={(published) => close(published)} />
    ), { dismissable: false });
    await refresh();
  };

  const onPull = (): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      const r = await ipc.git.pull({ wsId });
      if ('error' in r) setError(r.error);
      else await refresh();
    });

  const onCheckout = (name: string): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      try {
        await ipc.git.branch({ wsId, op: 'checkout', name });
      } catch (e) {
        const emsg = errText(e);
        // 該分支已在其他 git worktree 簽出：git 禁止同一分支兩處同時簽出（stash 無濟於事）→
        // 升級成「跳到該 worktree」動作（F-13/REQ-WT-005；DF-5 純文字提示的後繼）。
        const conflict = parseWorktreeConflict(emsg);
        if (conflict.isConflict) {
          if (conflict.path && wsId) {
            const jump = await dialog.confirm({
              title: '分支已在其他 worktree 簽出',
              body: `分支「${neutralizeBidi(name)}」已在另一個 git worktree（${neutralizeBidi(conflict.path)}）簽出，無法在此同時簽出。要跳到該 worktree 嗎？`,
              confirmText: '跳到該 worktree',
              cancelText: '取消',
            });
            if (jump) await jumpToWorktree(conflict.path);
          } else {
            setError(`分支「${name}」已在其他 git worktree 簽出，無法在此同時簽出。`);
          }
          return;
        }
        // checkout 失敗：以「結構化 status」判斷是否因工作區有未提交變更被擋——不靠 git 錯誤字串
        // （在地化 locale 會翻譯、untracked 也含 'overwritten by checkout'，字串比對兩頭不可靠）。
        const cur = await ipc.git.changes({ wsId }).catch(() => [] as GitChange[]);
        if (cur.length === 0) throw e; // 工作樹乾淨 → 是別的錯誤（分支不存在等），照原樣回報
        const choice = await dialog.open((close) => <DirtyCheckoutPrompt branch={name} onChoose={close} />);
        if (choice !== 'stash') return; // 取消：維持原分支
        // -u：tracked + untracked 全收，確保工作樹乾淨（untracked 不收會讓第二次 checkout 仍被擋）。
        await ipc.git.stash({ wsId, op: 'push', includeUntracked: true });
        try {
          await ipc.git.branch({ wsId, op: 'checkout', name });
        } catch (e2) {
          // 變更已安全進 stash 但仍切不過去 → 明確告知去向，刷新讓 UI 與真實狀態一致，不留破碎中間態。
          setError(
            `變更已暫存到 stash，但切換到「${name}」仍失敗：${errText(e2)}。你目前仍在原分支，可在「變更」分頁按 Stash Pop 取回。`,
          );
          await refresh();
          return;
        }
      }
      await refresh();
      setBranches((prev) => ({ ...prev, current: statusRef.current?.branch ?? name }));
    });

  /**
   * F-13/REQ-WT-005：跳到某 worktree 路徑。已納管→切換；未納管→lineage 驗證後納管並開啟。
   */
  const jumpToWorktree = async (path: string): Promise<void> => {
    if (!wsId) return;
    const listRes = await ipc.git.worktreeList({ wsId });
    const target = 'list' in listRes ? resolveJumpTarget(listRes.list, path) : { action: 'not-found' as const };
    if (target.action === 'switch') {
      appStore.setActiveWorkspace(target.wsId); // 已套 canSwitchWorktree（prunable/isMain 不走此路，A3）
      return;
    }
    if (target.action === 'prune-or-warn') {
      setError('該 worktree 已失效或不可切換（資料夾可能已刪除）。請到 worktree 分頁清理失效登記。');
      return;
    }
    if (target.action === 'not-found') {
      setError('找不到對應的 worktree。可能已被移除。');
      return;
    }
    // adopt：未納管 → 確認後納管（後端做 lineage 交叉驗證＋路徑圍堵，驗不過回錯）。路徑經 neutralizeBidi 防偽裝（A5）。
    const ok = await dialog.confirm({
      title: '加入為工作區並開啟',
      body: `該 worktree（${neutralizeBidi(path)}）尚未加入 Polydesk。要驗證來源並加入為工作區後開啟嗎？`,
      confirmText: '加入並開啟',
      cancelText: '取消',
    });
    if (!ok) return;
    const r = await ipc.git.worktreeAdopt({ wsId, path });
    if ('wsId' in r) {
      await appStore.loadWorkspaces();
      appStore.setActiveWorkspace(r.wsId);
    } else {
      setError(
        r.code === 'not-lineage'
          ? '無法加入：該 worktree 來源驗證失敗，可能不屬於此 repo。'
          : neutralizeBidi(r.error),
      );
    }
  };

  /** F-13/入口③：對某分支「在新 worktree 開啟」（預填分支開建立對話框）。 */
  const openWorktreeForBranch = async (branch: string): Promise<void> => {
    if (!wsId) return;
    await dialog.open((close) => <CreateWorktreeDialog wsId={wsId} wsPath={wsPath} presetBranch={branch} onResult={(v) => close(v)} />);
  };

  const onCreateBranch = async (): Promise<void> => {
    if (!wsId) return;
    const name = (await dialog.open((close) => <CreateBranchForm onDone={close} />)) as string | undefined;
    if (!name) return;
    await run(async () => {
      await ipc.git.branch({ wsId, op: 'create', name });
      await ipc.git.branch({ wsId, op: 'checkout', name });
      await refresh();
      const r = await ipc.git.branch({ wsId, op: 'list' });
      if ('branches' in r) setBranches({ list: r.branches, current: r.current });
      setTab('branches');
    });
  };

  const onStash = (op: 'push' | 'pop'): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      // push 帶 -u（含 untracked）：與變更清單顯示一致（含新檔），不會「點了沒反應」；pop 忽略此旗標。
      await ipc.git.stash({ wsId, op, includeUntracked: true });
      await refresh();
    });

  // 取消變更（discard）：破壞性、不可復原 → 確認後才執行。
  const onDiscard = (paths: string[], label: string): Promise<void> =>
    run(async () => {
      if (!wsId || paths.length === 0) return;
      const ok = await dialog.confirm({
        title: '取消變更',
        body: `將捨棄${label}的未提交變更：已追蹤檔還原到上次提交（改動不可復原）、未追蹤新檔移到系統資源回收桶（可從回收桶救回）。確定？`,
        confirmText: '捨棄變更',
        cancelText: '取消',
      });
      if (!ok) return;
      await ipc.git.discard({ wsId, paths: [...new Set(paths)] });
      await refresh();
    });

  // 加到 .gitignore（非破壞性）。
  const onIgnore = (paths: string[]): Promise<void> =>
    run(async () => {
      if (!wsId || paths.length === 0) return;
      await ipc.git.ignore({ wsId, paths });
      await refresh();
    });

  // PE-1：簽出某 commit（分離 HEAD；hash 經後端 validateRef）。
  const onCheckoutCommit = (c: GitLogEntry): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      const ok = await dialog.confirm({
        title: '簽出此 commit（分離 HEAD）',
        body: `將進入「分離 HEAD」狀態（不在任何分支上）。確定簽出 ${c.hash.slice(0, 7)}？`,
        confirmText: '簽出',
        cancelText: '取消',
      });
      if (!ok) return;
      try {
        await ipc.git.branch({ wsId, op: 'checkout', name: c.hash });
      } catch (e) {
        setError(errText(e));
        return;
      }
      await refresh();
      const r = await ipc.git.branch({ wsId, op: 'list' });
      if ('branches' in r) setBranches({ list: r.branches, current: r.current });
    });

  // PE-1：從某 commit 建立分支（git branch <name> <commit> → checkout）。
  const onBranchFromCommit = async (c: GitLogEntry): Promise<void> => {
    if (!wsId) return;
    const name = (await dialog.open((close) => <CreateBranchForm onDone={close} />)) as string | undefined;
    if (!name) return;
    await run(async () => {
      await ipc.git.branch({ wsId, op: 'create', name, startPoint: c.hash });
      await ipc.git.branch({ wsId, op: 'checkout', name });
      await refresh();
      const r = await ipc.git.branch({ wsId, op: 'list' });
      if ('branches' in r) setBranches({ list: r.branches, current: r.current });
      setTab('branches');
    });
  };

  // 點變更檔 → 在編輯器區開差異分頁（工作樹 vs HEAD，like VSCode），不再佔用側欄面板。
  const openDiff = (c: GitChange): void => {
    if (!wsId) return;
    editorBus.openDiff({ wsId, path: c.path, staged: c.staged });
  };

  // PE-1：hover 卡片延遲關閉 — 離開列後延遲 200ms 才關，期間滑入卡片可取消（才能滾動卡片內容）。
  const cancelHoverClose = (): void => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const scheduleHoverClose = (): void => {
    cancelHoverClose();
    hoverTimer.current = setTimeout(() => setHover(null), 200);
  };

  // PE-1：點 commit → 展開/收合該 commit 變更的檔案清單（like VSCode）；首次展開載入並快取。
  const toggleExpand = (c: GitLogEntry): void => {
    if (!wsId) return;
    setExpanded((prev) => (prev === c.hash ? null : c.hash));
    if (cFiles[c.hash] === undefined) {
      void ipc.git
        .commitFiles({ wsId, ref: c.hash })
        .then((r) => setCFiles((prev) => ({ ...prev, [c.hash]: r.files })))
        .catch(() => setCFiles((prev) => ({ ...prev, [c.hash]: [] })));
    }
  };

  // ── 渲染分支 ──
  if (!wsId) {
    return (
      <section className="pd-scm">
        <div className="pd-panel-header">原始碼控制</div>
        <div className="pd-scm-empty">請先選擇一個工作區。</div>
      </section>
    );
  }

  if (loading && !status) {
    return (
      <section className="pd-scm">
        <div className="pd-panel-header">
          <span>原始碼控制</span>
          <span className="pd-scm-hdr-actions">
            <span className="pd-scm-icon is-loading" aria-hidden="true">
              ⟳
            </span>
          </span>
        </div>
        <div className="pd-scm-loadbar" role="progressbar" aria-label="讀取中" aria-busy="true">
          <span />
        </div>
        {/* 讀取中骨架（shimmer）＝動態回饋，取代靜態「載入中…」的呆滯感。 */}
        <div className="pd-scm-skeleton" aria-hidden="true">
          <div className="pd-scm-skel-line pd-scm-skel-head" />
          <div className="pd-scm-skel-row" />
          <div className="pd-scm-skel-row" />
          <div className="pd-scm-skel-row" />
          <div className="pd-scm-skel-row short" />
        </div>
        <span role="status" aria-live="polite" className="pd-scm-sr">
          讀取中…
        </span>
      </section>
    );
  }

  if (status && !status.isRepo) {
    return (
      <section className="pd-scm">
        <div className="pd-panel-header">原始碼控制</div>
        <div className="pd-scm-empty">
          <p>此工作區尚未初始化 git。</p>
          <button
            className="pd-btn pd-btn-primary"
            aria-label="初始化 git 儲存庫"
            onClick={() => void onInit()}
            disabled={busy}
          >
            {busy ? '初始化中…' : 'git init'}
          </button>
        </div>
      </section>
    );
  }

  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => !c.staged);

  return (
    <section className="pd-scm">
      <div className="pd-panel-header">
        <span>原始碼控制</span>
        <span className="pd-scm-hdr-actions">
          {busy && (
            <span className="pd-scm-busy" role="status" aria-live="polite">
              進行中…
            </span>
          )}
          <button
            className={`pd-scm-icon${loading || fetching ? ' is-loading' : ''}`}
            aria-label={loading || fetching ? '讀取中' : '重新整理'}
            title={fetching ? '取回遠端狀態中…' : loading ? '讀取中…' : '重新整理（含取回遠端狀態）'}
            onClick={() => {
              // 先以單次 snapshot 更新本地狀態，再依最新 hasRemote 決定是否 fetch；成功後補一次快照。
              void refresh().then(() => fetchRemote(true));
            }}
            disabled={busy}
          >
            ⟳
          </button>
        </span>
      </div>

      {/* 讀取／操作進行中：頂部不定量進度條（sweep）＝清楚的「還在讀取」動態回饋。 */}
      {(loading || busy) && (
        <div className="pd-scm-loadbar" role="progressbar" aria-label={loading ? '讀取中' : '進行中'} aria-busy="true">
          <span />
        </div>
      )}

      {/* 分支 / 同步列 */}
      <div className="pd-scm-syncbar">
        <span className="pd-scm-branch" title="目前分支" aria-label={`目前分支 ${status?.branch ?? 'N/A'}`}>
          ⎇ {status?.detached ? '（分離 HEAD）' : (status?.branch ?? 'N/A')}
        </span>
        <span className="pd-scm-ab" aria-label={`領先 ${nOrNA(status?.ahead ?? null)}、落後 ${nOrNA(status?.behind ?? null)}`}>
          {(status?.ahead ?? 0) > 0 ? (
            <span className="pd-scm-ahead">↑{status?.ahead} 未推送</span>
          ) : (
            <>↑{nOrNA(status?.ahead ?? null)}</>
          )}{' '}
          {(status?.behind ?? 0) > 0 ? (
            <span className="pd-scm-behind">↓{status?.behind} 未拉取</span>
          ) : (
            <>↓{nOrNA(status?.behind ?? null)}</>
          )}
        </span>
        <span className="pd-scm-syncbtns">
          {status?.isRepo && status.hasRemote === false ? (
            // DF-12：沒有 remote 時 push 必失敗——改給「發佈到 GitHub」一鍵建 repo＋推送（VS Code 同款）。
            <button
              className="pd-scm-icon pd-scm-publish"
              aria-label="發佈到 GitHub"
              title="發佈到 GitHub（用 gh 建立遠端 repository 並推送）"
              onClick={() => void onPublish()}
              disabled={busy}
            >
              ⇪ 發佈
            </button>
          ) : (
            <>
              <button
                className="pd-scm-icon"
                aria-label={(status?.behind ?? 0) > 0 ? `拉取（pull）：${status?.behind} 個 commit 未拉取` : '拉取（pull）'}
                title={(status?.behind ?? 0) > 0 ? `拉取 ${status?.behind} 個未拉取的 commit` : '拉取'}
                onClick={() => void onPull()}
                disabled={busy}
              >
                ↓{(status?.behind ?? 0) > 0 && <span className="pd-scm-count" aria-hidden="true">{status?.behind}</span>}
              </button>
              <button
                className="pd-scm-icon"
                aria-label={(status?.ahead ?? 0) > 0 ? `推送（push）：${status?.ahead} 個 commit 未推送` : '推送（push）'}
                title={(status?.ahead ?? 0) > 0 ? `推送 ${status?.ahead} 個未推送的 commit` : '推送'}
                onClick={() => void onPush()}
                disabled={busy}
              >
                ↑{(status?.ahead ?? 0) > 0 && <span className="pd-scm-count" aria-hidden="true">{status?.ahead}</span>}
              </button>
            </>
          )}
        </span>
      </div>

      {/* PE-4：手動取回失敗的小字提示（離線/認證屬常態情境，不佔錯誤橫幅）。 */}
      {fetchHint && (
        <div className="pd-scm-fetch-hint" role="status">
          {fetchHint}
        </div>
      )}

      {/* 分頁 */}
      <div className="pd-scm-tabs" role="tablist" aria-label="原始碼控制分頁">
        {(
          [
            ['changes', '變更'],
            ['history', '歷史'],
            ['branches', '分支'],
            ['worktree', 'worktree'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`pd-scm-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="pd-scm-error" role="alert">
          {error}
        </div>
      )}

      {tab === 'changes' && (
        <div className="pd-scm-body pd-scroll">
          <div className="pd-scm-commit">
            <textarea
              className="pd-input pd-scm-msg"
              aria-label="commit 訊息"
              placeholder="commit 訊息"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div
              className="pd-scm-commit-actions"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}
            >
              {/* ✨ 智慧產生（依已暫存變更 + 選定引擎）→ 只回填訊息框，不自動 commit */}
              <button
                className="pd-btn"
                aria-label="智慧產生 commit 訊息（依已暫存的變更）"
                title={`用 ${{ claude: 'Claude', codex: 'Codex', agy: 'Agy', custom: '自訂 CLI' }[engine]} 依已暫存變更產生 commit 訊息`}
                onClick={() => void onGenerateMsg()}
                disabled={genBusy || busy}
                style={{ padding: '2px 10px', flexShrink: 0 }}
              >
                {genBusy ? '產生中…' : '✨ 產生'}
              </button>
              <select
                className="pd-input"
                aria-label="commit 訊息產生引擎"
                value={engine}
                onChange={(e) => onEngineChange(e.target.value as AiEngine)}
                style={{ width: 'auto', padding: '2px 6px', flexShrink: 0 }}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="agy">Agy</option>
              </select>
              <button
                className="pd-btn pd-btn-primary pd-scm-commitbtn"
                aria-label="提交（commit）"
                onClick={() => void onCommit()}
                disabled={busy || staged.length === 0 || message.trim().length === 0}
                style={{ marginLeft: 'auto', flexShrink: 0 }}
              >
                {busy ? '提交中…' : `提交 (${staged.length})`}
              </button>
            </div>
          </div>

          {changes.length > 0 && (
            <div className="pd-scm-changesbar">
              <button
                className="pd-scm-link pd-scm-link-danger"
                aria-label="全部取消變更"
                onClick={() => void onDiscard(changes.map((c) => c.path), '全部')}
                disabled={busy}
              >
                全部取消變更
              </button>
            </div>
          )}

          <ChangeGroup
            title="已暫存的變更"
            items={staged}
            busy={busy}
            actionLabel="取消暫存"
            onAction={(p) => void onStage(p, false)}
            onAll={staged.length ? () => void onStageAll(false, staged.map((c) => c.path)) : undefined}
            allLabel="全部取消暫存"
            onOpen={openDiff}
            onContext={(c, e) => setChangeMenu({ c, x: e.clientX, y: e.clientY })}
          />
          <ChangeGroup
            title="變更"
            items={unstaged}
            busy={busy}
            actionLabel="暫存"
            onAction={(p) => void onStage(p, true)}
            onAll={unstaged.length ? () => void onStageAll(true, unstaged.map((c) => c.path)) : undefined}
            allLabel="全部暫存"
            onOpen={openDiff}
            onContext={(c, e) => setChangeMenu({ c, x: e.clientX, y: e.clientY })}
          />

          {changes.length === 0 && <div className="pd-scm-empty">沒有變更。</div>}

          <div className="pd-scm-stash">
            <button className="pd-btn" aria-label="暫存變更（stash）" onClick={() => void onStash('push')} disabled={busy}>
              Stash
            </button>
            <button className="pd-btn" aria-label="還原暫存（stash pop）" onClick={() => void onStash('pop')} disabled={busy}>
              Stash Pop
            </button>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="pd-scm-body pd-scroll">
          {log.length === 0 ? (
            <div className="pd-scm-empty">尚無提交紀錄。</div>
          ) : (
            (() => {
              const graph = computeGitGraph(log);
              const graphW = graph.maxLanes * GRAPH_LANE_W + 6;
              return log.map((c, i) => {
                const files = cFiles[c.hash];
                return (
                  <React.Fragment key={c.hash}>
                    {/* 列高單一真相＝GRAPH_ROW_H（與 SVG 高同源）；列高===SVG高才能跨列無縫不斷線。 */}
                    <div
                      className={`pd-scm-logrow${expanded === c.hash ? ' is-expanded' : ''}`}
                      style={{ height: GRAPH_ROW_H }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded === c.hash}
                      aria-label={`commit：${c.subject}${c.refs.length > 0 ? `，${c.refs.map(refLabel).join('、')}` : ''}（點擊展開變更檔案）`}
                      onMouseEnter={(e) => {
                        cancelHoverClose();
                        const r = e.currentTarget.getBoundingClientRect();
                        setHover({ c, top: r.top, left: r.right + 8 });
                      }}
                      onMouseLeave={scheduleHoverClose}
                      onClick={() => toggleExpand(c)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpand(c);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        cancelHoverClose();
                        setHover(null);
                        setCommitMenu({ c, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <GitGraphCell row={graph.rows[i]} width={graphW} />
                      <div className="pd-scm-logtext">
                        <span className="pd-scm-logline1">
                          <span className="pd-scm-logsubject">{c.subject}</span>
                          {c.refs.length > 0 && <RefBadges refs={c.refs} />}
                        </span>
                        <span className="pd-scm-logmeta">
                          {c.author} · {new Date(c.date).toLocaleString()} · {c.hash.slice(0, 7)}
                        </span>
                      </div>
                    </div>
                    {expanded === c.hash && (
                      <div className="pd-scm-commitfiles" role="list" aria-label={`commit ${c.hash.slice(0, 7)} 變更檔案`}>
                        {files === undefined ? (
                          <div className="pd-scm-commitfiles-empty">載入中…</div>
                        ) : files.length === 0 ? (
                          <div className="pd-scm-commitfiles-empty">無檔案變更。</div>
                        ) : (
                          files.map((f) => (
                            <button
                              key={f.path}
                              type="button"
                              role="listitem"
                              className="pd-scm-commitfile"
                              aria-label={`開啟差異：${f.path}`}
                              title={f.path}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (wsId) editorBus.openDiff({ wsId, path: f.path, staged: false, commit: c.hash, commitPath: f.path });
                              }}
                            >
                              <span className={`pd-scm-cfstatus pd-scm-cf-${f.status}`} aria-hidden="true">
                                {f.status}
                              </span>
                              <span className="pd-scm-cfpath">{f.path}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              });
            })()
          )}
          {hover && (
            <CommitHoverCard
              c={hover.c}
              top={hover.top}
              left={hover.left}
              onEnter={cancelHoverClose}
              onLeave={scheduleHoverClose}
            />
          )}
        </div>
      )}

      {tab === 'branches' && (
        <div className="pd-scm-body pd-scroll">
          <div className="pd-scm-stash">
            <button className="pd-btn pd-btn-primary" aria-label="建立新分支" onClick={() => void onCreateBranch()} disabled={busy}>
              ＋ 新分支
            </button>
          </div>
          {branches.list.length === 0 ? (
            <div className="pd-scm-empty">尚無分支。</div>
          ) : (
            branches.list.map((b) => (
              <div key={b} className="pd-row pd-scm-branchrow pdwt-branchrow" style={{ alignItems: 'center' }}>
                <button
                  className={`pdwt-branch-switch${b === branches.current ? ' is-active' : ''}`}
                  style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-1)', background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: b === branches.current ? 'default' : 'pointer', padding: 0 }}
                  aria-label={b === branches.current ? `目前分支 ${b}` : `切換到分支 ${b}`}
                  aria-current={b === branches.current}
                  onClick={() => b !== branches.current && void onCheckout(b)}
                  disabled={busy || b === branches.current}
                >
                  <span className="pd-scm-branchdot" aria-hidden="true">
                    {b === branches.current ? '●' : '○'}
                  </span>
                  <span className="pd-scm-branchname">{b}</span>
                </button>
                <button
                  className="pdws-actbtn"
                  aria-label={`在新 worktree 開啟 ${b}`}
                  title="在新 worktree 開啟"
                  onClick={() => void openWorktreeForBranch(b)}
                  disabled={busy}
                >
                  ⎇＋
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'worktree' && wsId && <WorktreePanel wsId={wsId} wsPath={wsPath} />}

      {commitMenu && (
        <div
          className="pd-scm-ctxmenu"
          role="menu"
          aria-label="commit 操作"
          style={{ top: Math.min(commitMenu.y, window.innerHeight - 210), left: Math.min(commitMenu.x, window.innerWidth - 220) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              // 走 clipboard IPC：renderer 的 navigator.clipboard 被 REQ-SEC-001 權限封鎖（必 NotAllowedError）
              ['複製雜湊', () => void ipc.clipboard.writeText({ text: commitMenu.c.hash }).catch(() => {})],
              [
                '複製訊息',
                () =>
                  void ipc.clipboard
                    .writeText({ text: commitMenu.c.body ? `${commitMenu.c.subject}\n\n${commitMenu.c.body}` : commitMenu.c.subject })
                    .catch(() => {}),
              ],
              [
                '開啟此 commit 變更',
                () => {
                  if (wsId) editorBus.openDiff({ wsId, path: commitMenu.c.hash.slice(0, 7), staged: false, commit: commitMenu.c.hash });
                },
              ],
              ['簽出此 commit（分離 HEAD）', () => void onCheckoutCommit(commitMenu.c)],
              ['從此 commit 建立分支…', () => void onBranchFromCommit(commitMenu.c)],
            ] as [string, () => void][]
          ).map(([label, act]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="pd-scm-ctxitem"
              onClick={() => {
                setCommitMenu(null);
                act();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {changeMenu && (
        <div
          className="pd-scm-ctxmenu"
          role="menu"
          aria-label="變更檔操作"
          style={{ top: Math.min(changeMenu.y, window.innerHeight - 160), left: Math.min(changeMenu.x, window.innerWidth - 200) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              [
                changeMenu.c.staged ? '取消暫存' : '暫存',
                () => void onStage(changeMenu.c.path, !changeMenu.c.staged),
              ],
              ['取消變更（捨棄）', () => void onDiscard([changeMenu.c.path], `「${changeMenu.c.path}」`)],
              ['加到 .gitignore', () => void onIgnore([changeMenu.c.path])],
            ] as [string, () => void][]
          ).map(([label, act]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="pd-scm-ctxitem"
              onClick={() => {
                setChangeMenu(null);
                act();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** PE-1：commit hover 卡片（完整訊息 + 作者/時間/完整 hash）。固定定位於列右側、夾在視窗內；可滑入滾動（延遲關閉）。 */
function CommitHoverCard({
  c,
  top,
  left,
  onEnter,
  onLeave,
}: {
  c: GitLogEntry;
  top: number;
  left: number;
  onEnter: () => void;
  onLeave: () => void;
}): React.JSX.Element {
  return (
    <div
      className="pd-scm-hovercard"
      role="tooltip"
      style={{ top: Math.min(top, window.innerHeight - 220), left: Math.min(left, window.innerWidth - 340) }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="pd-scm-hovercard-subject">{c.subject}</div>
      {c.body && <div className="pd-scm-hovercard-body">{c.body}</div>}
      <div className="pd-scm-hovercard-meta">
        <span>{c.author}</span>
        <span> · {new Date(c.date).toLocaleString()}</span>
        <span className="pd-scm-hovercard-hash">{c.hash}</span>
      </div>
    </div>
  );
}

function ChangeGroup(props: {
  title: string;
  items: GitChange[];
  busy: boolean;
  actionLabel: string;
  onAction: (path: string) => void;
  onAll?: () => void;
  allLabel: string;
  onOpen: (c: GitChange) => void;
  onContext?: (c: GitChange, e: React.MouseEvent) => void;
}): React.JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <div className="pd-scm-group">
      <div className="pd-scm-grouphead">
        <span className="pd-scm-grouplabel">
          {props.title} ({props.items.length})
        </span>
        {props.onAll && (
          <button className="pd-scm-link" aria-label={props.allLabel} onClick={props.onAll} disabled={props.busy}>
            {props.allLabel}
          </button>
        )}
      </div>
      {props.items.map((c) => (
        <div
          key={`${c.staged}:${c.path}`}
          className="pd-row pd-scm-change"
          onContextMenu={
            props.onContext
              ? (e) => {
                  e.preventDefault();
                  props.onContext?.(c, e);
                }
              : undefined
          }
        >
          <button
            className="pd-scm-changemain"
            aria-label={`檢視差異：${c.path}`}
            title={c.path}
            onClick={() => props.onOpen(c)}
          >
            <StatusBadge s={c.status} />
            <span className="pd-scm-changepath">{c.path}</span>
          </button>
          <button
            className="pd-scm-link"
            aria-label={`${props.actionLabel}：${c.path}`}
            onClick={() => props.onAction(c.path)}
            disabled={props.busy}
          >
            {props.actionLabel}
          </button>
        </div>
      ))}
    </div>
  );
}

/** 切換分支前工作區有未提交變更時的處置彈窗：先 stash 再切換（可逆），或取消。 */
function DirtyCheckoutPrompt({
  branch,
  onChoose,
}: {
  branch: string;
  onChoose: (result?: unknown) => void;
}): React.JSX.Element {
  return (
    <div style={{ minWidth: 380 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>
        切換分支前需處理未提交變更
      </h2>
      <p style={{ margin: '0 0 16px', color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
        工作區有未提交的變更，直接切換到「{branch}」會被 git 阻擋。可先把變更 <strong>Stash</strong>（暫存）再切換；
        之後在「變更」分頁按 <strong>Stash Pop</strong> 即可取回。
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="pd-btn" aria-label="取消切換分支" onClick={() => onChoose(undefined)}>
          取消
        </button>
        <button
          className="pd-btn pd-btn-primary"
          aria-label="Stash 變更並切換分支"
          onClick={() => onChoose('stash')}
        >
          Stash 並切換
        </button>
      </div>
    </div>
  );
}

function CreateBranchForm({ onDone }: { onDone: (result?: unknown) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  return (
    <div style={{ minWidth: 320 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>建立新分支</h2>
      <input
        className="pd-input"
        aria-label="新分支名稱"
        placeholder="例如 feature/login"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onDone(name.trim());
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="pd-btn" aria-label="取消" onClick={() => onDone(undefined)}>
          取消
        </button>
        <button
          className="pd-btn pd-btn-primary"
          aria-label="建立分支"
          disabled={name.trim().length === 0}
          onClick={() => onDone(name.trim())}
        >
          建立並切換
        </button>
      </div>
    </div>
  );
}
