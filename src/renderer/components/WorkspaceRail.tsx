// 工作區列表（F-1）：新增 / 切換 / 行內改名 / 移除（含 purge profile 二次確認）/ 拖曳排序
// + 空狀態歡迎頁 + Claude 徽章 + missing 灰化。對應 REQ-WS-001/002/003/004/006/007/008/010、
// REQ-PERF-002、REQ-E2E-001。
//
// 紅軍對應：
//   F-1-A1 名稱一律走 React 文字節點 {neutralizeBidi(name)} + CSS 截斷，行內改名用受控
//          <input value> 讀 .value（非 innerHTML），嚴禁 dangerouslySetInnerHTML。
//   F-1-A2 切換埋點 try/catch 容缺不擋切換；首次載入記 'wsFirstLoad'、已切換過才記 'wsSwitch'
//          （避免首載慢樣本污染 REQ-PERF-002 桶）。
//   F-1-A3 missing 工作區不綁切換 onClick（灰化 + 移除入口），不會把 active 指向不存在路徑。
//   F-1-A4 新增前一律經 TrustConfirm（內含根目錄/超大樹警告），確認後才 ipc.workspace.add。
//   F-1-A5 移除 purge checkbox 預設 false、狀態存於 dialog 自身（隔離列表重繪）、勾選需二次確認。

import React, { useEffect, useState } from 'react';
import { appStore, useAppState } from '../state/appStore';
import { ipc } from '../ipc/client';
import { dialog } from './Dialogs/host';
import { mark, measure } from '../../shared/perf';
import { EmptyWelcome } from './EmptyWelcome';
import { ClaudeStatusBadge } from './ClaudeStatusBadge';
import { TrustConfirm, neutralizeBidi } from './Dialogs/TrustConfirm';
import { confirmCloseWorkspace } from './Dialogs/CloseConfirm';
import { CreateWorktreeDialog } from './Worktree/CreateWorktreeDialog';
import { CloneRepositoryDialog } from './CloneRepositoryDialog';
import { worktreeBranchDisplay } from './Worktree/worktreeModel';
import type { Workspace } from '../../shared/types';

// ── 一次性注入本 feature 的 rail 樣式（不改 P-2 的 components.css；全用 var(--*) token）──
const STYLE_ID = 'pdws-rail-style';
function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = [
    '.pdws-item{position:relative;}',
    '.pdws-name-btn{flex:1;min-width:0;display:flex;align-items:center;background:transparent;border:none;color:inherit;font:inherit;text-align:left;padding:0;cursor:pointer;}',
    '.pdws-name-btn:disabled{cursor:not-allowed;}',
    '.pdws-name-btn:focus-visible{box-shadow:var(--focus-ring);outline:none;border-radius:var(--radius-sm);}',
    '.pdws-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.pdws-actions{display:flex;gap:2px;opacity:0;transition:opacity var(--motion-fast) var(--ease-standard);}',
    '.pdws-item:hover .pdws-actions,.pdws-item:focus-within .pdws-actions{opacity:1;}',
    '.pdws-item.is-missing{opacity:0.55;}',
    '.pdws-item.is-dragover{box-shadow:inset 0 2px 0 0 var(--accent);}',
    '.pdws-actbtn{background:transparent;border:none;color:var(--meta);cursor:pointer;padding:2px 6px;border-radius:var(--radius-sm);font-size:var(--text-sm);line-height:1;transition:color var(--motion-fast) var(--ease-standard),background var(--motion-fast) var(--ease-standard);}',
    '.pdws-actbtn:hover{color:var(--fg);background:var(--surface-warm);}',
    '.pdws-actbtn:active{transform:translateY(0.5px);}',
    '.pdws-actbtn:focus-visible{box-shadow:var(--focus-ring);outline:none;}',
    '.pdws-actbtn.is-danger:hover{color:var(--danger);}',
  ].join('');
  document.head.appendChild(el);
}

// 已切換過的工作區（perf 分桶用）：首次載入記 wsFirstLoad、再次切換才記 wsSwitch（F-1-A2）。
const switchedOnce = new Set<string>();

/** 切換作用工作區並埋點（REQ-PERF-002）。missing 不可切（F-1-A3）。 */
function selectWorkspace(w: Workspace): void {
  if (w.status === 'missing') return;
  mark('wsSwitch:start');
  const repeat = w.hydrated || switchedOnce.has(w.id);
  appStore.setActiveWorkspace(w.id);
  switchedOnce.add(w.id);
  try {
    measure(repeat ? 'wsSwitch' : 'wsFirstLoad', 'wsSwitch:start');
  } catch {
    // 缺 mark（首屏/clearPerf）也不擋切換 —— 切換已先發生（F-1-A2）。
  }
}

/** 重排：把 from 移到 target 之前（target 不在則置尾）。 */
function moveBefore(ids: string[], from: string, target: string): string[] {
  const out = ids.filter((x) => x !== from);
  const idx = out.indexOf(target);
  if (idx === -1) out.push(from);
  else out.splice(idx, 0, from);
  return out;
}

/**
 * 新增工作區流程（rail 標頭鈕與歡迎頁 CTA 共用）：
 * pickFolder → 取消即罷 → TrustConfirm（含根目錄/超大樹警告）→ 確認才 add → 處理 duplicate/invalid。
 * export 供 EmptyWelcome 之外的呼叫端共用（目前由本檔以 callback 注入）。
 */
export async function addWorkspaceFlow(): Promise<void> {
  const { path } = await ipc.workspace.pickFolder();
  if (!path) return; // 使用者取消
  const confirmed = (await dialog.open((close) => (
    <TrustConfirm path={path} onResult={(v) => close(v)} />
  ))) as boolean | undefined;
  if (!confirmed) return; // 取消 / Esc / 點外關閉
  const res = await ipc.workspace.add({ path });
  if ('error' in res) {
    await dialog.confirm({
      title: res.error === 'duplicate' ? '工作區已存在' : '無法新增工作區',
      body:
        res.error === 'duplicate'
          ? '這個資料夾已經在工作區列表中了。'
          : '選取的路徑無效或不是資料夾，請重新選擇。',
      confirmText: '知道了',
      cancelText: '關閉',
    });
    return;
  }
  await appStore.loadWorkspaces();
  appStore.setActiveWorkspace(res.id);
}

/**
 * 從 Git 分支建立 worktree（入口②）：以當前作用工作區為來源 repo 開對話框（REQ-WT-001②）。
 * 無作用工作區時提示先選一個 git repo 工作區。
 */
export async function createWorktreeFlow(): Promise<void> {
  const active = appStore.activeWorkspace();
  if (!active) {
    await dialog.confirm({ title: '請先選擇工作區', body: '從分支建立 worktree 需要一個 git repo 工作區當來源。', confirmText: '知道了', cancelText: '關閉' });
    return;
  }
  await dialog.open((close) => (
    <CreateWorktreeDialog wsId={active.id} wsPath={active.path} onResult={(v) => close(v)} />
  ));
}

/** Clone 遠端 repository，成功後由對話框重載並切換工作區。Clone 中禁止點外或 Esc 關閉。 */
export async function cloneRepositoryFlow(): Promise<void> {
  await dialog.open((close) => (
    <CloneRepositoryDialog onResult={(wsId) => close(wsId)} />
  ), { dismissable: false });
}

/**
 * worktree 工作區的即時分支徽章（REQ-WT-004＋紅軍 A1）：分支名經 git status 即時查、
 * 一律走 React 文字節點＋neutralizeBidi（禁 innerHTML，防惡意分支名 XSS/RLO 偽裝）；
 * detached HEAD 顯示明確文字、不渲染 'null'、不由資料夾名回推。
 */
function WorktreeBranchTag({ wsId }: { wsId: string }): React.JSX.Element {
  const [branch, setBranch] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await ipc.git.status({ wsId });
        if (alive) setBranch(s.isRepo ? s.branch : null);
      } catch {
        if (alive) setBranch(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [wsId]);
  const text = worktreeBranchDisplay(branch);
  return (
    <span
      title={text}
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--meta)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: 90,
      }}
    >
      ⎇ {text}
    </span>
  );
}

/**
 * 排序＋分組：worktree 工作區緊列於「所屬主工作樹」項之下（REQ-WT-004）。
 * 以 worktree.mainPath 比對主工作樹 path（win32 大小寫不敏感）；主工作樹不在列表的 worktree 置尾。
 */
function groupByMainRepo(list: Workspace[]): Workspace[] {
  const norm = (p: string): string => {
    const s = p.replace(/[\\/]+$/, '');
    return typeof navigator !== 'undefined' && /win/i.test(navigator.platform) ? s.toLowerCase() : s;
  };
  const mains = list.filter((w) => !w.worktree).sort((a, b) => a.order - b.order);
  const wts = list.filter((w) => w.worktree);
  const byMain = new Map<string, Workspace[]>();
  const orphans: Workspace[] = [];
  for (const wt of wts) {
    const key = norm(wt.worktree!.mainPath);
    const main = mains.find((m) => norm(m.path) === key);
    if (main) (byMain.get(main.id) ?? byMain.set(main.id, []).get(main.id)!).push(wt);
    else orphans.push(wt);
  }
  const out: Workspace[] = [];
  for (const m of mains) {
    out.push(m);
    for (const wt of byMain.get(m.id) ?? []) out.push(wt);
  }
  return [...out, ...orphans];
}

/** 移除確認彈窗：purge checkbox 狀態存於本元件（隔離外部列表重繪），勾選刪資料需二次確認（F-1-A5）。 */
function RemoveWorkspaceDialog({
  name,
  onResult,
}: {
  name: string;
  onResult: (r: { confirmed: boolean; purgeProfile: boolean }) => void;
}): React.JSX.Element {
  const [purge, setPurge] = useState(false);
  const [confirmingPurge, setConfirmingPurge] = useState(false);

  const onRemove = (): void => {
    if (purge && !confirmingPurge) {
      setConfirmingPurge(true); // 勾了刪資料 → 先要二次確認，不立即移除
      return;
    }
    onResult({ confirmed: true, purgeProfile: purge });
  };

  return (
    <div style={{ minWidth: 380, maxWidth: 480 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>
        移除工作區
      </h2>
      <p style={{ margin: '0 0 12px', color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
        確定要把「{neutralizeBidi(name)}」從列表移除嗎？資料夾本身不會被刪除。
      </p>
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
          color: 'var(--fg-2)',
          cursor: 'pointer',
          lineHeight: 1.5,
        }}
      >
        <input
          type="checkbox"
          checked={purge}
          onChange={(e) => {
            setPurge(e.target.checked);
            setConfirmingPurge(false); // 改動勾選 → 重置二次確認
          }}
          aria-label="連同 Playwright 瀏覽資料（登入態 / cookie / 快取）一併刪除"
          style={{ marginTop: 2 }}
        />
        <span>連同 Playwright 瀏覽資料（登入態 / cookie / 快取）一併刪除（不可復原）</span>
      </label>
      {purge && confirmingPurge && (
        <p role="alert" style={{ margin: '12px 0 0', color: 'var(--danger)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
          這會永久刪除該工作區的瀏覽資料，無法復原。再次點擊「永久刪除」以確認。
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button
          className="pd-btn"
          onClick={() => onResult({ confirmed: false, purgeProfile: false })}
          aria-label="取消移除"
        >
          取消
        </button>
        <button
          className={purge ? 'pd-btn pd-btn-danger' : 'pd-btn pd-btn-primary'}
          onClick={onRemove}
          aria-label={purge ? (confirmingPurge ? '永久刪除工作區與瀏覽資料' : '移除並刪除瀏覽資料') : '移除工作區'}
          autoFocus
        >
          {purge ? (confirmingPurge ? '永久刪除' : '移除並刪除資料') : '移除'}
        </button>
      </div>
    </div>
  );
}

/** 移除流程：開 RemoveWorkspaceDialog → 依結果 ipc.workspace.remove → 重載。 */
async function removeFlow(w: Workspace): Promise<void> {
  const r = (await dialog.open((close) => (
    <RemoveWorkspaceDialog name={w.name} onResult={(res) => close(res)} />
  ))) as { confirmed: boolean; purgeProfile: boolean } | undefined;
  if (!r?.confirmed) return; // 取消 / Esc → 不移除
  // 跨 feature 整合（REQ-TERM-007/E2E-008）：有跑中終端機程序時先確認，避免誤殺進行中工作。
  if (!(await confirmCloseWorkspace(w.id, w.name))) return;
  await ipc.workspace.remove({ wsId: w.id, purgeProfile: r.purgeProfile });
  await appStore.loadWorkspaces();
}

export function WorkspaceRail(): React.JSX.Element {
  const { workspaces, activeWorkspaceId } = useAppState();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  useEffect(() => {
    ensureStyle();
  }, []);

  // worktree 緊列所屬主工作樹之下（REQ-WT-004）。
  const ordered = groupByMainRepo(workspaces);

  const startRename = (w: Workspace): void => {
    setEditingId(w.id);
    setEditValue(w.name);
  };
  const commitRename = async (w: Workspace): Promise<void> => {
    const raw = editValue; // 受控 input 的 value（非 innerHTML）→ 傳原字串（F-1-A1）
    setEditingId(null);
    if (raw.trim() === '' || raw === w.name) return;
    await ipc.workspace.rename({ wsId: w.id, name: raw });
    await appStore.loadWorkspaces();
  };

  const onDrop = (target: Workspace): void => {
    const from = dragId;
    setOverId(null);
    setDragId(null);
    if (!from || from === target.id) return;
    const ids = ordered.map((w) => w.id);
    const next = moveBefore(ids, from, target.id);
    if (next.join(' ') === ids.join(' ')) return;
    void (async () => {
      await ipc.workspace.reorder({ orderedIds: next });
      await appStore.loadWorkspaces();
    })();
  };

  return (
    <aside
      aria-label="工作區列表"
      style={{
        width: 'var(--rail-w)',
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div className="pd-panel-header" style={{ position: 'relative' }}>
        <span>工作區</span>
        <button
          className="pdws-actbtn"
          aria-label="新增"
          title="新增工作區 / worktree"
          aria-haspopup="menu"
          aria-expanded={addMenuOpen}
          onClick={() => setAddMenuOpen((v) => !v)}
        >
          ＋
        </button>
        {addMenuOpen && (
          <>
            {/* 點外關閉 */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setAddMenuOpen(false)} />
            <div
              role="menu"
              aria-label="新增選單"
              style={{
                position: 'absolute',
                top: '100%',
                right: 4,
                zIndex: 41,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--elev-raised)',
                minWidth: 210,
                padding: 4,
              }}
            >
              <button
                role="menuitem"
                className="pd-row"
                style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}
                aria-label="新增工作區"
                onClick={() => {
                  setAddMenuOpen(false);
                  void addWorkspaceFlow();
                }}
              >
                新增工作區…
              </button>
              <button
                role="menuitem"
                className="pd-row"
                style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}
                aria-label="Clone Git Repository"
                onClick={() => {
                  setAddMenuOpen(false);
                  void cloneRepositoryFlow();
                }}
              >
                Clone Git Repository…
              </button>
              <button
                role="menuitem"
                className="pd-row"
                style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}
                aria-label="從 Git 分支建立 worktree"
                onClick={() => {
                  setAddMenuOpen(false);
                  void createWorktreeFlow();
                }}
              >
                ⎇ 從 Git 分支建立 worktree…
              </button>
            </div>
          </>
        )}
      </div>

      {ordered.length === 0 ? (
        <EmptyWelcome onAdd={() => void addWorkspaceFlow()} onClone={() => void cloneRepositoryFlow()} />
      ) : (
        <div
          className="pd-scroll"
          role="list"
          aria-label="工作區"
          style={{ flex: 1, padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {ordered.map((w) => {
            const isMissing = w.status === 'missing';
            const isActive = activeWorkspaceId === w.id && !isMissing;
            const isEditing = editingId === w.id;
            const isWorktree = !!w.worktree;
            return (
              <div
                key={w.id}
                role="listitem"
                aria-current={isActive ? 'true' : undefined}
                style={{
                  ...(isWorktree ? { paddingLeft: 'var(--space-4)' } : {}),
                  ...(!isMissing && !isEditing ? { cursor: 'pointer' } : {}),
                }}
                className={`pdws-item pd-row${isActive ? ' is-active' : ''}${isMissing ? ' is-missing' : ''}${
                  overId === w.id ? ' is-dragover' : ''
                }`}
                // 整列可點切換（bug 修復）：切換 handler 原本只綁在名字按鈕，點到左側 Claude/Codex 徽章或
                // 空白格會落空、無法切換工作區。改為整列可點（missing/編輯中除外）＝對齊 VS Code 側欄慣例；
                // 列內子按鈕（名字/改名/移除）各自 stopPropagation 避免誤觸切換。名字仍是 <button>＝保留鍵盤路徑。
                onClick={isMissing || isEditing ? undefined : () => selectWorkspace(w)}
                draggable={!isEditing}
                onDragStart={(e) => {
                  setDragId(w.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', w.id);
                }}
                onDragOver={(e) => {
                  if (dragId && dragId !== w.id) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (overId !== w.id) setOverId(w.id);
                  }
                }}
                onDragLeave={() => {
                  if (overId === w.id) setOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(w);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
              >
                {isMissing ? (
                  <span aria-hidden="true" title="資料夾遺失" style={{ color: 'var(--warn)', flexShrink: 0 }}>
                    ⚠
                  </span>
                ) : isWorktree ? (
                  <span aria-label="worktree 工作區" title="git worktree" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                    ⎇
                  </span>
                ) : (
                  <ClaudeStatusBadge wsId={w.id} />
                )}

                {isEditing ? (
                  <input
                    className="pd-input"
                    value={editValue}
                    autoFocus
                    aria-label="重新命名工作區"
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(w);
                      else if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => void commitRename(w)}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                ) : (
                  <button
                    type="button"
                    className="pdws-name-btn"
                    disabled={isMissing}
                    onClick={isMissing ? undefined : (e) => { e.stopPropagation(); selectWorkspace(w); }}
                    onDoubleClick={isMissing ? undefined : (e) => { e.stopPropagation(); startRename(w); }}
                    title={w.path}
                    aria-label={
                      isMissing
                        ? `${neutralizeBidi(w.name)}（資料夾遺失，無法開啟）`
                        : `開啟工作區 ${neutralizeBidi(w.name)}`
                    }
                  >
                    <span className="pdws-name">{neutralizeBidi(w.name)}</span>
                  </button>
                )}

                {!isEditing && isWorktree && !isMissing && <WorktreeBranchTag wsId={w.id} />}

                {!isEditing && (
                  <span className="pdws-actions">
                    {!isMissing && (
                      <button
                        className="pdws-actbtn"
                        aria-label={`重新命名 ${neutralizeBidi(w.name)}`}
                        title="重新命名"
                        onClick={(e) => { e.stopPropagation(); startRename(w); }}
                      >
                        ✎
                      </button>
                    )}
                    <button
                      className="pdws-actbtn is-danger"
                      aria-label={`移除 ${neutralizeBidi(w.name)}`}
                      title="移除"
                      onClick={(e) => { e.stopPropagation(); void removeFlow(w); }}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
