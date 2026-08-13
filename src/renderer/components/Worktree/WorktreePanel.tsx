// SCM「worktree」分頁（F-12；REQ-WT-006/007/008/009/014）：列出該 repo 全部 worktree、
// 切換到此、移除（三範圍＋dirty 兩段確認）、＋建立（重用對話框）；失效登記逐筆確認，不做全域 prune。
// 分支名/路徑一律經 neutralizeBidi/worktreeBranchDisplay（禁 innerHTML）。

import React, { useCallback, useEffect, useState } from 'react';
import { ipc } from '../../ipc/client';
import { appStore } from '../../state/appStore';
import { dialog } from '../Dialogs/host';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';
import { CreateWorktreeDialog } from './CreateWorktreeDialog';
import { worktreeBranchDisplay, worktreePathDisplay, canSwitchWorktree } from './worktreeModel';
import { planRemoval, confirmedDirtyRemoval, scopeDeletesBranch, scopeDeletesFolder, type WorktreeCleanupScope } from './worktreeRemoveModel';
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
    // 未納管（外部建立）：就地詢問後 lineage 驗證納管並切換（複用 F-13 adopt，取代原「請去分支分頁」死路）。
    // 後端 worktreeAdopt 做 lineage 交叉驗證＋路徑圍堵，驗不過回錯——不因就地入口而放寬安全。
    const ok = await dialog.confirm({
      title: '加入為工作區並開啟',
      body: `此 worktree（${neutralizeBidi(worktreePathDisplay(wt.path))}）尚未加入 Polydesk。要驗證來源並加入為工作區後開啟嗎？`,
      confirmText: '加入並開啟',
      cancelText: '取消',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await ipc.git.worktreeAdopt({ wsId, path: wt.path });
      if ('wsId' in r) {
        await appStore.loadWorkspaces();
        appStore.setActiveWorkspace(r.wsId);
        await reload();
      } else {
        setError(
          r.code === 'not-lineage'
            ? '無法加入：該 worktree 來源驗證失敗，可能不屬於此 repo。'
            : neutralizeBidi(r.error),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (wt: GitWorktree): Promise<void> => {
    if (wt.prunable && wt.branch) {
      const ok = await dialog.confirm({
        title: '移除失效 worktree 登記',
        body: '資料夾已不存在；只會移除這一筆 Git 登記並保留本地分支，不會執行全域 prune。確定繼續嗎？',
        confirmText: '移除登記',
        cancelText: '取消',
      });
      if (!ok) return;
      setBusy(true);
      try {
        const preview = await ipc.git.cleanupPreview({ wsId, branch: wt.branch });
        if (!preview.ok) {
          setError(preview.error);
          return;
        }
        const target = preview.snapshot.worktrees.find((entry) => entry.branch === wt.branch && entry.prunable);
        if (!target) {
          setError('失效登記狀態已變更，請重新載入後再試。');
          return;
        }
        const plannedPreview = await ipc.git.cleanupPreview({ wsId, branch: wt.branch, removeWorktreeIds: [target.id] });
        if (!plannedPreview.ok) {
          setError(plannedPreview.error);
          return;
        }
        const result = await ipc.git.cleanupExecute({
          wsId,
          branch: wt.branch,
          leaseToken: plannedPreview.leaseToken,
          localPlan: { deleteBranch: false, worktrees: [{ id: target.id, mode: 'stale-registration' }] },
          confirmation: { forceLocal: false, acceptExternalWriteRisk: false, remoteTargets: [] },
        });
        if (!result.ok) setError(result.error);
        await appStore.loadWorkspaces();
        await reload();
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!wt.managedWsId) {
      await dialog.confirm({ title: '無法移除', body: '此 worktree 尚未加入 Polydesk。', confirmText: '知道了', cancelText: '關閉' });
      return;
    }
    const targetWsId = wt.managedWsId;
    // 三選一：僅移出列表 / 刪資料夾保留 branch / 完整清理。
    const choice = (await dialog.open((close) => (
      <RemoveChoiceDialog branch={worktreeBranchDisplay(wt.branch)} canDeleteBranch={wt.branch !== null} onResult={(v) => close(v)} />
    ))) as WorktreeCleanupScope | undefined;
    if (!choice) return;

    setError(null);
    setBusy(true);
    try {
      // 會刪資料夾時先查未提交變更數（dirty 兩段確認在刪除「之前」，避免半殘）。
      const changes = await ipc.git.changes({ wsId: targetWsId });
      const plan = planRemoval(scopeDeletesFolder(choice), changes.length);
      let force = false;
      if (plan.action === 'confirm-dirty') {
        const ok = (await dialog.open((close) => (
          <DirtyConfirmDialog changedCount={plan.changedCount} onResult={(v) => close(v)} />
        ))) as boolean | undefined;
        if (!ok) return;
        force = confirmedDirtyRemoval().force; // 兩段確認通過 → force
      }
      let unlock = false;
      if (wt.locked && scopeDeletesFolder(choice)) {
        unlock = await dialog.confirm({
          title: '解除 worktree 鎖定保護',
          body: `此 worktree${wt.lockReason ? `（${neutralizeBidi(wt.lockReason)}）` : ''}已鎖定。要明確解除保護後繼續嗎？`,
          confirmText: '解除並繼續',
          cancelText: '取消',
        });
        if (!unlock) return;
      }
      const anchorBranch = wt.branch ?? (await ipc.git.status({ wsId })).branch;
      if (!anchorBranch) {
        setError('無法取得具名本地分支作為清理租約基準，請先讓主工作樹切到本地分支。');
        return;
      }
      const preview = await ipc.git.cleanupPreview({ wsId, branch: anchorBranch });
      if (!preview.ok) {
        setError(preview.error);
        return;
      }
      const normalizedPath = wt.path.replace(/\\/g, '/').toLowerCase();
      const target = preview.snapshot.worktrees.find((entry) =>
        !entry.isMain && entry.displayPath.replace(/\\/g, '/').toLowerCase() === normalizedPath,
      );
      if (!target) {
        setError('worktree 狀態已變更，請重新載入後再試。');
        return;
      }
      const plannedPreview = scopeDeletesFolder(choice)
        ? await ipc.git.cleanupPreview({ wsId, branch: anchorBranch, removeWorktreeIds: [target.id] })
        : preview;
      if (!plannedPreview.ok) {
        setError(plannedPreview.error);
        return;
      }
      const cleaned = await ipc.git.cleanupExecute({
        wsId,
        branch: anchorBranch,
        leaseToken: plannedPreview.leaseToken,
        localPlan: {
          deleteBranch: scopeDeletesBranch(choice),
          worktrees: [{ id: target.id, mode: choice, unlock }],
        },
        confirmation: {
          forceLocal: force,
          acceptExternalWriteRisk: scopeDeletesFolder(choice),
          remoteTargets: [],
        },
      });
      if (!cleaned.ok) {
        setError(cleaned.error);
        return;
      }
      await appStore.loadWorkspaces();
      await reload();
    } catch (e) {
      setError(neutralizeBidi(e instanceof Error ? e.message : '移除 worktree 失敗'));
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

/** 移除三選一：列表、資料夾、完整分支清理。 */
function RemoveChoiceDialog({
  branch,
  canDeleteBranch,
  onResult,
}: {
  branch: string;
  canDeleteBranch: boolean;
  onResult: (r: WorktreeCleanupScope | undefined) => void;
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
        <button className="pd-btn" aria-label="刪除資料夾並保留分支" onClick={() => onResult('delete-folder')}>
          刪除資料夾，保留本地分支
        </button>
        {canDeleteBranch && (
          <button className="pd-btn pd-btn-danger" aria-label="完整清理資料夾與本地分支" onClick={() => onResult('full-cleanup')}>
            完整清理資料夾與本地分支
          </button>
        )}
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
