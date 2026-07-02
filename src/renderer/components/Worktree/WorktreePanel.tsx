// SCM「worktree」分頁（F-12；REQ-WT-006/007/008/009/014）：列出該 repo 全部 worktree、
// 切換到此、移除（二選一＋dirty 兩段確認）、＋建立（重用對話框）、清理失效登記(prune)。
// 分支名/路徑一律經 neutralizeBidi/worktreeBranchDisplay（禁 innerHTML）。

import React, { useCallback, useEffect, useState } from 'react';
import { ipc } from '../../ipc/client';
import { appStore } from '../../state/appStore';
import { dialog } from '../Dialogs/host';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';
import { CreateWorktreeDialog } from './CreateWorktreeDialog';
import { worktreeBranchDisplay, worktreePathDisplay, canSwitchWorktree } from './worktreeModel';
import { planRemoval, confirmedDirtyRemoval } from './worktreeRemoveModel';
import { mark, measure } from '../../../shared/perf';
import type { GitWorktree } from '../../../shared/types';

export function WorktreePanel({ wsId, wsPath }: { wsId: string; wsPath: string }): React.JSX.Element {
  const [list, setList] = useState<GitWorktree[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    mark('worktreeListLoad:start'); // REQ-PERF-005：worktree list→渲染 < 300ms
    const r = await ipc.git.worktreeList({ wsId });
    if ('list' in r) {
      setList(r.list);
      try {
        measure('worktreeListLoad', 'worktreeListLoad:start');
      } catch {
        /* 缺 mark：略過 */
      }
    } else {
      setList([]);
      setError(r.error);
    }
  }, [wsId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onCreate = async (): Promise<void> => {
    const created = (await dialog.open((close) => (
      <CreateWorktreeDialog wsId={wsId} wsPath={wsPath} onResult={(v) => close(v)} />
    ))) as string | null | undefined;
    if (created) await reload(); // 建立成功已切換工作區；刷新列表
  };

  const onSwitch = async (wt: GitWorktree): Promise<void> => {
    if (wt.managedWsId) {
      appStore.setActiveWorkspace(wt.managedWsId);
      return;
    }
    // 未納管（外部建立）：完整 lineage 驗證納管走 F-13；此處提示。
    await dialog.confirm({
      title: '此 worktree 尚未加入 Polydesk',
      body: '請於「分支」分頁對該分支使用「跳到該 worktree」以驗證來源並加入工作區。',
      confirmText: '知道了',
      cancelText: '關閉',
    });
  };

  const onPrune = async (): Promise<void> => {
    // 紅軍 A4：prune 需明確確認（暫時不可達的有效 worktree 也可能被 git 標 prunable，誤清＝孤兒）。
    const ok = await dialog.confirm({
      title: '清理失效登記',
      body: '這會移除「資料夾已不存在」的 worktree 登記（git worktree prune）。若某 worktree 只是暫時不可達（如網路磁碟斷線），請先確認它真的不要了。',
      confirmText: '清理',
      cancelText: '取消',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await ipc.git.worktreePrune({ wsId });
      if ('error' in r) setError(r.error);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (wt: GitWorktree): Promise<void> => {
    if (!wt.managedWsId) {
      await dialog.confirm({ title: '無法移除', body: '此 worktree 尚未加入 Polydesk。', confirmText: '知道了', cancelText: '關閉' });
      return;
    }
    const targetWsId = wt.managedWsId;
    // 二選一：僅移出列表 / 連同刪除
    const choice = (await dialog.open((close) => (
      <RemoveChoiceDialog branch={worktreeBranchDisplay(wt.branch)} onResult={(v) => close(v)} />
    ))) as 'list-only' | 'delete' | undefined;
    if (!choice) return;

    setBusy(true);
    try {
      if (choice === 'list-only') {
        await ipc.git.worktreeRemove({ wsId: targetWsId, deleteFolder: false, force: false });
        await appStore.loadWorkspaces();
        await reload();
        return;
      }
      // 連同刪除：先查未提交變更數（dirty 兩段確認在刪除「之前」，避免半殘）
      const changes = await ipc.git.changes({ wsId: targetWsId });
      const plan = planRemoval(true, changes.length);
      let force = false;
      if (plan.action === 'confirm-dirty') {
        const ok = (await dialog.open((close) => (
          <DirtyConfirmDialog changedCount={plan.changedCount} onResult={(v) => close(v)} />
        ))) as boolean | undefined;
        if (!ok) return;
        force = confirmedDirtyRemoval().force; // 兩段確認通過 → force
      }
      const r = await ipc.git.worktreeRemove({ wsId: targetWsId, deleteFolder: true, force });
      if ('error' in r) {
        setError(
          r.code === 'busy'
            ? '無法刪除：資料夾被佔用（可能有程序仍持有檔案）。請關閉相關程序後重試。'
            : r.code === 'dirty'
              ? '該 worktree 仍有未提交變更。請先提交/暫存，或確認丟棄後重試。'
              : r.error,
        );
      }
      await appStore.loadWorkspaces();
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pd-scm-body pd-scroll">
      <div className="pd-scm-stash" style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button className="pd-btn pd-btn-primary" aria-label="建立 worktree" onClick={() => void onCreate()} disabled={busy}>
          ＋ 建立
        </button>
        <button className="pd-btn" aria-label="清理失效登記" title="git worktree prune" onClick={() => void onPrune()} disabled={busy}>
          清理失效登記
        </button>
      </div>

      {error && (
        <div className="pd-scm-error" role="alert">
          {neutralizeBidi(error)}
        </div>
      )}

      {list === null ? (
        <div className="pd-scm-empty">載入中…</div>
      ) : list.length === 0 ? (
        <div className="pd-scm-empty">
          尚無 worktree。用上方「＋ 建立」從分支開一個平行工作區，各自開終端機互不干擾。
        </div>
      ) : (
        list.map((wt) => (
          <div key={wt.path} className="pd-row pd-scm-branchrow" style={{ alignItems: 'center' }}>
            <span className="pd-scm-branchdot" aria-hidden="true" style={{ color: 'var(--accent)' }}>
              ⎇
            </span>
            <span className="pd-scm-branchname" style={{ flex: 1, minWidth: 0 }} title={worktreePathDisplay(wt.path)}>
              {worktreeBranchDisplay(wt.branch)}
              {wt.isMain && <span style={{ color: 'var(--meta)', fontSize: 'var(--text-xs)' }}>（主工作樹）</span>}
              {wt.prunable && <span style={{ color: 'var(--warn)', fontSize: 'var(--text-xs)' }}>（失效）</span>}
            </span>
            {!wt.isMain && (
              <span style={{ display: 'flex', gap: 4 }}>
                <button
                  className="pd-btn pd-btn-sm"
                  aria-label={`切換到 worktree ${worktreeBranchDisplay(wt.branch)}`}
                  onClick={() => void onSwitch(wt)}
                  disabled={busy || !canSwitchWorktree(wt)}
                  title={canSwitchWorktree(wt) ? undefined : '失效登記無法切換，請先清理'}
                >
                  切換到此
                </button>
                <button
                  className="pd-btn pd-btn-sm"
                  aria-label={`移除 worktree ${worktreeBranchDisplay(wt.branch)}`}
                  onClick={() => void onRemove(wt)}
                  disabled={busy}
                >
                  移除
                </button>
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** 移除二選一（REQ-WT-006）：僅移出列表 / 連同刪除。 */
function RemoveChoiceDialog({
  branch,
  onResult,
}: {
  branch: string;
  onResult: (r: 'list-only' | 'delete' | undefined) => void;
}): React.JSX.Element {
  return (
    <div style={{ minWidth: 420, maxWidth: 520 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>移除 worktree</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
        要如何移除「{branch}」這個 worktree？
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="pd-btn" aria-label="僅從列表移出，保留資料夾" onClick={() => onResult('list-only')}>
          僅移出列表（保留資料夾，之後可再加回）
        </button>
        <button className="pd-btn pd-btn-danger" aria-label="連同刪除資料夾" onClick={() => onResult('delete')}>
          連同刪除資料夾（git worktree remove）
        </button>
        <button className="pd-btn" aria-label="取消移除" onClick={() => onResult(undefined)} style={{ marginTop: 4 }}>
          取消
        </button>
      </div>
    </div>
  );
}

/** dirty 兩段確認（REQ-WT-007）：列未提交變更數，勾「確定丟棄」才可 force 刪。 */
function DirtyConfirmDialog({
  changedCount,
  onResult,
}: {
  changedCount: number;
  onResult: (ok: boolean) => void;
}): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div style={{ minWidth: 420, maxWidth: 520 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>
        此 worktree 有未提交變更
      </h2>
      <p role="alert" style={{ margin: '0 0 12px', color: 'var(--danger)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
        偵測到 {changedCount} 個未提交變更。連同刪除會永久丟棄這些變更，無法復原。建議先提交或 stash。
      </p>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--fg-2)', cursor: 'pointer' }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-label="確定丟棄未提交變更" style={{ marginTop: 2 }} />
        <span>我確定要丟棄這些未提交變更並刪除 worktree</span>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="pd-btn" onClick={() => onResult(false)} aria-label="取消刪除">
          取消
        </button>
        <button
          className="pd-btn pd-btn-danger"
          onClick={() => onResult(true)}
          disabled={!confirmed}
          aria-label="確定丟棄並刪除"
        >
          丟棄並刪除
        </button>
      </div>
    </div>
  );
}
