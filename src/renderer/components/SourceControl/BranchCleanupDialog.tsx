import React, { useMemo, useState } from 'react';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';
import type { GitRemoteBranch } from '../../../shared/types';

export interface BranchCleanupDraft {
  branch: string;
  switchTo?: string;
  removeWorktrees: boolean;
  remoteTargets: Array<{ remote: string; name: string }>;
}

interface BranchCleanupDialogProps {
  branch: string;
  isCurrent: boolean;
  worktreePaths: string[];
  localBranches: string[];
  remoteCandidates: GitRemoteBranch[];
  onResult: (result?: BranchCleanupDraft) => void;
}

export function BranchCleanupDialog({
  branch,
  isCurrent,
  worktreePaths,
  localBranches,
  remoteCandidates,
  onResult,
}: BranchCleanupDialogProps): React.JSX.Element {
  const switchCandidates = useMemo(
    () => localBranches.filter((candidate) => candidate !== branch),
    [branch, localBranches],
  );
  const matchingRemotes = useMemo(
    () => remoteCandidates.filter((candidate) => candidate.name === branch),
    [branch, remoteCandidates],
  );
  const [switchTo, setSwitchTo] = useState(switchCandidates[0] ?? '');
  const [includeRemote, setIncludeRemote] = useState(false);
  const [selectedRemoteRefs, setSelectedRemoteRefs] = useState<string[]>([]);
  const hasWorktrees = worktreePaths.length > 0;
  const canContinue = (!isCurrent || switchTo.length > 0) && (!includeRemote || selectedRemoteRefs.length > 0);

  const toggleRemote = (candidate: GitRemoteBranch, checked: boolean): void => {
    setSelectedRemoteRefs((current) =>
      checked ? [...new Set([...current, candidate.ref])] : current.filter((ref) => ref !== candidate.ref),
    );
  };

  const submit = (): void => {
    if (!canContinue) return;
    onResult({
      branch,
      switchTo: isCurrent ? switchTo : undefined,
      removeWorktrees: hasWorktrees,
      remoteTargets: includeRemote
        ? matchingRemotes
            .filter((candidate) => selectedRemoteRefs.includes(candidate.ref))
            .map((candidate) => ({ remote: candidate.remote, name: candidate.name }))
        : [],
    });
  };

  return (
    <div className="pd-cleanup-dialog">
      <header className="pd-cleanup-header">
        <div className="pd-cleanup-title-row">
          <span className="pd-cleanup-title-icon" aria-hidden="true">⎇</span>
          <div>
            <h2>完整清理分支</h2>
            <p>先選清理範圍；下一步會重新掃描 Git 狀態與資料遺失風險。</p>
          </div>
        </div>
        <div className="pd-cleanup-branch" title={neutralizeBidi(branch)}>
          <span>本地分支</span>
          <code>{neutralizeBidi(branch)}</code>
        </div>
      </header>

      <section className="pd-cleanup-section" aria-labelledby="pd-cleanup-local-title">
        <div className="pd-cleanup-section-heading">
          <span className="pd-cleanup-step" aria-hidden="true">1</span>
          <div>
            <h3 id="pd-cleanup-local-title">本機清理</h3>
            <p>刪除本地分支本身，以及與它直接綁定的工作項目。</p>
          </div>
        </div>
        <div className="pd-cleanup-card is-selected">
          <div className="pd-cleanup-card-main">
            <span className="pd-cleanup-check" aria-hidden="true">✓</span>
            <div>
              <strong>刪除本地分支與 Git metadata</strong>
              <small>包含 branch ref、reflog、upstream 與 repository-local branch 設定。</small>
            </div>
          </div>
          {hasWorktrees && (
            <div className="pd-cleanup-nested" role="note">
              <strong>同時清理 {worktreePaths.length} 個使用中的 worktree</strong>
              {worktreePaths.map((path) => (
                <code key={path} title={neutralizeBidi(path)}>{neutralizeBidi(path)}</code>
              ))}
              <small>會先關閉 Polydesk 工作區，再刪除資料夾與 Git worktree 登記。</small>
            </div>
          )}
        </div>

        {isCurrent && (
          <div className="pd-cleanup-switch">
            <label htmlFor="pd-cleanup-switch-branch">目前正在使用此分支，先切換到</label>
            <select
              id="pd-cleanup-switch-branch"
              className="pd-input"
              value={switchTo}
              onChange={(event) => setSwitchTo(event.target.value)}
            >
              {switchCandidates.length === 0 && <option value="">沒有可切換的本地分支</option>}
              {switchCandidates.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
            </select>
            <small>工作樹必須乾淨；偵測到未提交變更時會停止，不會自動 stash。</small>
          </div>
        )}
      </section>

      <section className="pd-cleanup-section" aria-labelledby="pd-cleanup-remote-title">
        <div className="pd-cleanup-section-heading">
          <span className="pd-cleanup-step" aria-hidden="true">2</span>
          <div>
            <h3 id="pd-cleanup-remote-title">遠端清理（選用）</h3>
            <p>預設只清本機；只有明確勾選的伺服器分支才會刪除。</p>
          </div>
        </div>
        <label className="pd-cleanup-toggle">
          <input
            type="checkbox"
            checked={includeRemote}
            onChange={(event) => {
              setIncludeRemote(event.target.checked);
              if (!event.target.checked) setSelectedRemoteRefs([]);
            }}
          />
          <span>
            <strong>連同檢查遠端同名／upstream 分支</strong>
            <small>會即時連線確認實際 push endpoint；清單快照不會直接拿來刪除。</small>
          </span>
        </label>
        {includeRemote && (
          <div className="pd-cleanup-remotes">
            {matchingRemotes.length === 0 ? (
              <p>目前快照沒有同名遠端分支。下一步仍會即時查詢實際 upstream。</p>
            ) : (
              matchingRemotes.map((candidate) => (
                <label key={candidate.ref}>
                  <input
                    type="checkbox"
                    checked={selectedRemoteRefs.includes(candidate.ref)}
                    onChange={(event) => toggleRemote(candidate, event.target.checked)}
                  />
                  <span><code>{neutralizeBidi(candidate.ref)}</code><small>執行前會重新確認 tip 與 endpoint</small></span>
                </label>
              ))
            )}
          </div>
        )}
        {includeRemote && selectedRemoteRefs.length === 0 && <small role="alert">至少勾選一個遠端分支，或關閉遠端清理。</small>}
      </section>

      <div className="pd-cleanup-warning" role="note">
        <strong>此畫面尚未開始刪除。</strong>
        <span>按「檢查清理風險」後，Polydesk 才會列出未提交檔案、可能失去的 commit、鎖定與遠端結果，供最後一次確認。</span>
      </div>

      <footer className="pd-cleanup-actions">
        <button className="pd-btn" type="button" onClick={() => onResult(undefined)}>取消</button>
        <button className="pd-btn pd-btn-primary" type="button" disabled={!canContinue} onClick={submit} autoFocus>
          檢查清理風險
        </button>
      </footer>
    </div>
  );
}
