// 原始碼控制面板（REQ-SCM-001~009、REQ-MON-003、REQ-E2E-003）。
// 讀 activeWorkspace → git:status/changes；非 repo → git init；變更樹 stage/unstage；commit/push/pull；
// 分支切換/建立；歷史；stash。點檔開 monaco diff。操作進行中顯示「進行中」、失敗顯示明確錯誤。
// 全用既有 pd-* class + var(--*) token + scm.css；每互動元素具 aria-label 與微狀態。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../../ipc/client';
import { useAppState } from '../../state/appStore';
import { dialog } from '../Dialogs/host';
import { editorBus } from '../../state/editorBus';
import { appStore } from '../../state/appStore';
import { WorktreePanel } from '../Worktree/WorktreePanel';
import { CreateWorktreeDialog } from '../Worktree/CreateWorktreeDialog';
import { parseWorktreeConflict, resolveJumpTarget } from '../Worktree/worktreeModel';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';
import type { GitStatus, GitChange, GitLogEntry, AiEngine } from '../../../shared/types';
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

export function SourceControlPanel(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState();
  const wsId = activeWorkspaceId;
  const wsPath = workspaces.find((w) => w.id === wsId)?.path ?? '';

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // 世代號取消 stale 載入：大 repo 的 git status/changes 各要 ~1.5-2s 且 git 走 serial queue。快速連切
  // 工作區時，若不取消，切到最新工作區還得等前面每個 stale 載入跑完、且 stale 結果會回頭覆蓋當前 →
  // 面板卡在 loading。每次 refresh 遞增 gen，await 回來後 gen 不是最新就丟棄（不 setState、不搶 loading）。
  const loadGen = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const gen = ++loadGen.current;
    if (!wsId) {
      setStatus(null);
      setChanges([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const st = await ipc.git.status({ wsId });
      if (gen !== loadGen.current) return; // 期間又切了工作區：丟棄 stale
      setStatus(st);
      const ch = st.isRepo ? await ipc.git.changes({ wsId }) : [];
      if (gen !== loadGen.current) return;
      setChanges(ch);
    } catch (e) {
      if (gen === loadGen.current) setError(errText(e));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [wsId]);

  // 工作區切換 → 回變更分頁並刷新。防抖 120ms：快速連切只載入「最終停留」的工作區，中間掠過的
  // 不發 git 載入 → 不堆積 serial queue（實測連切 5 個大 repo 的 git status 會累積到 ~10s）。
  useEffect(() => {
    setTab('changes');
    const t = setTimeout(() => void refresh(), 120);
    return () => clearTimeout(t);
  }, [refresh]);

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

  const onPush = (): Promise<void> =>
    run(async () => {
      if (!wsId) return;
      const r = await ipc.git.push({ wsId });
      if ('error' in r) setError(r.error);
      else await refresh();
    });

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
      const r = await ipc.git.branch({ wsId, op: 'list' });
      if ('branches' in r) setBranches({ list: r.branches, current: r.current });
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
        <div className="pd-panel-header">原始碼控制</div>
        <div className="pd-scm-empty" aria-busy="true">
          載入中…
        </div>
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
            className="pd-scm-icon"
            aria-label="重新整理"
            title="重新整理"
            onClick={() => void refresh()}
            disabled={busy}
          >
            ⟳
          </button>
        </span>
      </div>

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
          <span className={(status?.behind ?? 0) > 0 ? 'pd-scm-behind' : undefined}>↓{nOrNA(status?.behind ?? null)}</span>
        </span>
        <span className="pd-scm-syncbtns">
          <button className="pd-scm-icon" aria-label="拉取（pull）" title="拉取" onClick={() => void onPull()} disabled={busy}>
            ↓
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
        </span>
      </div>

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
                title={`用 ${engine === 'codex' ? 'Codex' : 'Claude'} 依已暫存變更產生 commit 訊息`}
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
                      aria-label={`commit：${c.subject}（點擊展開變更檔案）`}
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
                        <span className="pd-scm-logsubject">{c.subject}</span>
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
              ['複製雜湊', () => void navigator.clipboard?.writeText(commitMenu.c.hash).catch(() => {})],
              [
                '複製訊息',
                () =>
                  void navigator.clipboard
                    ?.writeText(commitMenu.c.body ? `${commitMenu.c.subject}\n\n${commitMenu.c.body}` : commitMenu.c.subject)
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
