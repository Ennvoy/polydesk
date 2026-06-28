// 原始碼控制面板（REQ-SCM-001~009、REQ-MON-003、REQ-E2E-003）。
// 讀 activeWorkspace → git:status/changes；非 repo → git init；變更樹 stage/unstage；commit/push/pull；
// 分支切換/建立；歷史；stash。點檔開 monaco diff。操作進行中顯示「進行中」、失敗顯示明確錯誤。
// 全用既有 pd-* class + var(--*) token + scm.css；每互動元素具 aria-label 與微狀態。

import React, { useCallback, useEffect, useState } from 'react';
import { ipc } from '../../ipc/client';
import { useAppState } from '../../state/appStore';
import { dialog } from '../Dialogs/host';
import type { GitStatus, GitChange, GitLogEntry } from '../../../shared/types';
import { DiffView } from './DiffView';
import { computeGitGraph, type GitGraphRow } from './gitGraph';

type Tab = 'changes' | 'history' | 'branches';

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
interface Selected {
  path: string;
  staged: boolean;
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
  const { activeWorkspaceId } = useAppState();
  const wsId = activeWorkspaceId;

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<Tab>('changes');
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [branches, setBranches] = useState<{ list: string[]; current: string }>({ list: [], current: '' });
  const [selected, setSelected] = useState<Selected | null>(null);
  const [patch, setPatch] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!wsId) {
      setStatus(null);
      setChanges([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const st = await ipc.git.status({ wsId });
      setStatus(st);
      setChanges(st.isRepo ? await ipc.git.changes({ wsId }) : []);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  // 工作區切換 → 重置選取並刷新。
  useEffect(() => {
    setSelected(null);
    setPatch('');
    setTab('changes');
    void refresh();
  }, [refresh]);

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
      await ipc.git.stash({ wsId, op });
      await refresh();
    });

  const openDiff = (c: GitChange): void => {
    if (!wsId) return;
    setSelected({ path: c.path, staged: c.staged });
    setDiffLoading(true);
    setError(null);
    void ipc.git
      .diff({ wsId, path: c.path, staged: c.staged })
      .then((r) => setPatch(r.patch))
      .catch((e) => {
        setError(errText(e));
        setPatch('');
      })
      .finally(() => setDiffLoading(false));
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

  // 選取檔 → 全面板 diff（含返回）。
  if (selected) {
    return (
      <section className="pd-scm">
        <div className="pd-panel-header">
          <button
            className="pd-btn pd-scm-back"
            aria-label="返回變更清單"
            onClick={() => {
              setSelected(null);
              setPatch('');
            }}
          >
            ← 返回
          </button>
          <span className="pd-scm-difftitle" title={selected.path}>
            {selected.path}
          </span>
        </div>
        {diffLoading ? (
          <div className="pd-scm-empty" aria-busy="true">
            載入差異中…
          </div>
        ) : (
          <DiffView path={selected.path} patch={patch} />
        )}
      </section>
    );
  }

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
          ↑{nOrNA(status?.ahead ?? null)} ↓{nOrNA(status?.behind ?? null)}
        </span>
        <span className="pd-scm-syncbtns">
          <button className="pd-scm-icon" aria-label="拉取（pull）" title="拉取" onClick={() => void onPull()} disabled={busy}>
            ↓
          </button>
          <button className="pd-scm-icon" aria-label="推送（push）" title="推送" onClick={() => void onPush()} disabled={busy}>
            ↑
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
            <button
              className="pd-btn pd-btn-primary pd-scm-commitbtn"
              aria-label="提交（commit）"
              onClick={() => void onCommit()}
              disabled={busy || staged.length === 0 || message.trim().length === 0}
            >
              {busy ? '提交中…' : `提交 (${staged.length})`}
            </button>
          </div>

          <ChangeGroup
            title="已暫存的變更"
            items={staged}
            busy={busy}
            actionLabel="取消暫存"
            onAction={(p) => void onStage(p, false)}
            onAll={staged.length ? () => void onStageAll(false, staged.map((c) => c.path)) : undefined}
            allLabel="全部取消暫存"
            onOpen={openDiff}
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
              return log.map((c, i) => (
                // 列高單一真相＝GRAPH_ROW_H（與 SVG 高同源）；列高===SVG高才能跨列無縫不斷線。
                <div key={c.hash} className="pd-scm-logrow" title={c.hash} style={{ height: GRAPH_ROW_H }}>
                  <GitGraphCell row={graph.rows[i]} width={graphW} />
                  <div className="pd-scm-logtext">
                    <span className="pd-scm-logsubject">{c.subject}</span>
                    <span className="pd-scm-logmeta">
                      {c.author} · {new Date(c.date).toLocaleString()} · {c.hash.slice(0, 7)}
                    </span>
                  </div>
                </div>
              ));
            })()
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
              <button
                key={b}
                className={`pd-row pd-scm-branchrow${b === branches.current ? ' is-active' : ''}`}
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
            ))
          )}
        </div>
      )}
    </section>
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
        <div key={`${c.staged}:${c.path}`} className="pd-row pd-scm-change">
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
