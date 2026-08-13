import React, { useMemo, useState } from 'react';
import type { GitCleanupSnapshot } from '../../../shared/gitCleanup';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';

export interface BranchCleanupRiskDecision {
  forceLocal: boolean;
  acceptExternalWriteRisk: boolean;
  unlockWorktreeIds: string[];
}

interface BranchCleanupRiskDialogProps {
  branch: string;
  snapshot: GitCleanupSnapshot;
  deleteLocal: boolean;
  removeWorktreeIds: string[];
  onResult: (result?: BranchCleanupRiskDecision) => void;
}

export function BranchCleanupRiskDialog({
  branch,
  snapshot,
  deleteLocal,
  removeWorktreeIds,
  onResult,
}: BranchCleanupRiskDialogProps): React.JSX.Element {
  const plannedWorktrees = useMemo(
    () => snapshot.worktrees.filter((worktree) => removeWorktreeIds.includes(worktree.id)),
    [removeWorktreeIds, snapshot.worktrees],
  );
  const selectedEndpoints = snapshot.remote?.plan.endpoints.filter((endpoint) =>
    snapshot.remote?.selectedEndpointIds.includes(endpoint.id),
  ) ?? [];
  const requiresForce = deleteLocal && (!snapshot.localRisk.safeDelete || !snapshot.objectGraph.complete)
    || plannedWorktrees.some((worktree) => worktree.dirty !== false);
  const requiresExternalRisk = plannedWorktrees.length > 0;
  const [forceLocal, setForceLocal] = useState(false);
  const [acceptExternalWriteRisk, setAcceptExternalWriteRisk] = useState(false);
  const [unlockWorktreeIds, setUnlockWorktreeIds] = useState<string[]>([]);
  const remoteBlocked = Boolean(snapshot.remote && (
    snapshot.remote.unresolvedTargets.length > 0
    || !snapshot.remote.plan.objectGraphComplete
    || selectedEndpoints.some((endpoint) => endpoint.status !== 'exists' || !endpoint.expectedOid)
  ));
  const lockedReady = plannedWorktrees.every((worktree) => !worktree.locked || unlockWorktreeIds.includes(worktree.id));
  const canExecute = !remoteBlocked
    && (!requiresForce || forceLocal)
    && (!requiresExternalRisk || acceptExternalWriteRisk)
    && lockedReady;

  const toggleUnlock = (id: string, checked: boolean): void => {
    setUnlockWorktreeIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  };

  return (
    <div className="pd-cleanup-dialog" data-testid="branch-cleanup-risk-dialog">
      <header className="pd-cleanup-header">
        <div className="pd-cleanup-title-row">
          <span className="pd-cleanup-title-icon" aria-hidden="true">!</span>
          <div>
            <h2>確認完整清理風險</h2>
            <p>以下是剛剛重新掃描的 Git、worktree 與遠端 endpoint；狀態變動就會拒絕舊租約。</p>
          </div>
        </div>
        <div className="pd-cleanup-branch"><span>目標分支</span><code>{neutralizeBidi(branch)}</code></div>
      </header>

      {deleteLocal && (
        <section className="pd-cleanup-section" aria-labelledby="pd-cleanup-risk-local">
          <div className="pd-cleanup-section-heading">
            <span className="pd-cleanup-step" aria-hidden="true">1</span>
            <div><h3 id="pd-cleanup-risk-local">本機 ref 與 commit</h3><p>本地分支、branch metadata 與 reflog 會以 CAS 清理。</p></div>
          </div>
          <div className="pd-cleanup-card is-selected">
            <div className="pd-cleanup-card-main"><span className="pd-cleanup-check" aria-hidden="true">✓</span><div>
              <strong>{snapshot.localRisk.safeDelete ? 'Git 判定可安全刪除' : '分支含尚未安全合併的 commit'}</strong>
              <small>{snapshot.localRisk.exact ? `完成後可能失去 ${snapshot.localRisk.lostCommitCount} 個 commit` : `至少 ${snapshot.localRisk.lostCommitCount} 個本機可見 commit；完整數量未知`}</small>
            </div></div>
          </div>
          {!snapshot.objectGraph.complete && <div className="pd-cleanup-warning" role="alert"><strong>repository 歷史不完整</strong><span>shallow、partial clone 或缺失 object 讓 commit 風險只能顯示本機下限。</span></div>}
        </section>
      )}

      {plannedWorktrees.length > 0 && (
        <section className="pd-cleanup-section" aria-labelledby="pd-cleanup-risk-worktrees">
          <div className="pd-cleanup-section-heading"><span className="pd-cleanup-step" aria-hidden="true">2</span><div>
            <h3 id="pd-cleanup-risk-worktrees">Worktree 資料夾</h3><p>逐筆顯示 dirty、locked 與 prunable 狀態；主工作樹不會列入刪除。</p>
          </div></div>
          <div className="pd-cleanup-remotes">
            {plannedWorktrees.map((worktree) => (
              <div key={worktree.id} className="pd-cleanup-card">
                <code title={neutralizeBidi(worktree.displayPath)}>{neutralizeBidi(worktree.displayPath)}</code>
                <small>{worktree.dirty === null ? 'dirty 未知' : worktree.dirty ? '有未提交／ignored 內容' : '乾淨'} · {worktree.locked ? `已鎖定${worktree.lockReason ? `：${neutralizeBidi(worktree.lockReason)}` : ''}` : '未鎖定'} · {worktree.prunable ? '可清理失效登記' : '有效登記'}</small>
                {worktree.locked && <label><input type="checkbox" checked={unlockWorktreeIds.includes(worktree.id)} onChange={(event) => toggleUnlock(worktree.id, event.target.checked)} /> 明確解除此 worktree 鎖定</label>}
              </div>
            ))}
          </div>
        </section>
      )}

      {snapshot.remote && (
        <section className="pd-cleanup-section" aria-labelledby="pd-cleanup-risk-remotes">
          <div className="pd-cleanup-section-heading"><span className="pd-cleanup-step" aria-hidden="true">3</span><div>
            <h3 id="pd-cleanup-risk-remotes">遠端 endpoint</h3><p>只刪第一階段明確勾選的 remote/branch，執行前還會重驗 endpoint 與 expected OID。</p>
          </div></div>
          <div className="pd-cleanup-remotes">
            {selectedEndpoints.map((endpoint) => (
              <div key={endpoint.id} className="pd-cleanup-card">
                <code>{neutralizeBidi(endpoint.remote)}/{neutralizeBidi(endpoint.branch)}</code>
                <small>{neutralizeBidi(endpoint.display)} · {endpoint.status === 'exists' && endpoint.expectedOid ? `tip ${endpoint.expectedOid.slice(0, 12)}` : `狀態 unknown：${neutralizeBidi(endpoint.reason ?? '無法證明精確 ref')}`}</small>
              </div>
            ))}
            {snapshot.remote.unresolvedTargets.map((target) => <div key={`${target.remote}/${target.branch}`} className="pd-cleanup-warning"><strong>{neutralizeBidi(target.remote)}/{neutralizeBidi(target.branch)}</strong><span>{neutralizeBidi(target.reason)}</span></div>)}
          </div>
          {remoteBlocked && <div className="pd-cleanup-warning" role="alert"><strong>遠端狀態不足以安全執行</strong><span>返回上一步、修正 remote／權限或取得完整 object graph 後重新檢查；unknown 不會被當成已刪除。</span></div>}
        </section>
      )}

      {requiresForce && <label className="pd-cleanup-toggle"><input type="checkbox" checked={forceLocal} onChange={(event) => setForceLocal(event.target.checked)} /><span><strong>我確認強制清理本機未知／未合併內容</strong><small>這可能讓 commit 或未提交檔案無法再由目前 refs 找回。</small></span></label>}
      {requiresExternalRisk && <label className="pd-cleanup-toggle"><input type="checkbox" checked={acceptExternalWriteRisk} onChange={(event) => setAcceptExternalWriteRisk(event.target.checked)} /><span><strong>我了解確認後外部程序仍可能寫入資料夾</strong><small>Polydesk 會在不可逆步驟前重驗，但無法凍結外部 editor、build 或其他 Git 程序。</small></span></label>}

      <footer className="pd-cleanup-actions">
        <button className="pd-btn" type="button" onClick={() => onResult(undefined)}>返回</button>
        <button className="pd-btn pd-btn-danger" type="button" disabled={!canExecute} onClick={() => onResult({ forceLocal, acceptExternalWriteRisk, unlockWorktreeIds })}>開始完整清理</button>
      </footer>
    </div>
  );
}
