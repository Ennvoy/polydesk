// Clone Git Repository 對話框：URL、父資料夾、目標資料夾名與明確信任確認。

import React, { useState } from 'react';
import { ipc } from '../ipc/client';
import { appStore } from '../state/appStore';
import { cloneDirectoryNameError, cloneDirectoryNameFromUrl, cloneUrlError } from '../../shared/gitClone';
import { neutralizeBidi } from './Dialogs/TrustConfirm';

export function CloneRepositoryDialog({ onResult }: { onResult: (wsId: string | null) => void }): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [directoryName, setDirectoryName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGitHubLogin, setNeedsGitHubLogin] = useState(false);

  const urlProblem = url ? cloneUrlError(url) : null;
  const nameProblem = directoryName ? cloneDirectoryNameError(directoryName) : null;

  const pickParent = async (): Promise<void> => {
    const picked = await ipc.workspace.pickCloneParent();
    if (picked.path) setParentPath(picked.path);
  };

  const submit = async (): Promise<void> => {
    const uError = cloneUrlError(url);
    const nError = cloneDirectoryNameError(directoryName);
    if (uError || nError || !parentPath) {
      setError(uError ?? nError ?? '請選擇 Repository 的存放位置。');
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsGitHubLogin(false);
    try {
      const res = await ipc.git.clone({ url, parentPath, directoryName });
      if ('error' in res) {
        if (res.code === 'github-login-required') setNeedsGitHubLogin(true);
        const prefix =
          res.code === 'github-login-required'
            ? '這可能是 GitHub 私有 Repository。請先登入有權限的 GitHub 帳號，再自動重試 Clone。'
            : res.code === 'auth'
            ? '認證失敗。請確認 Git Credential Manager 或 SSH 金鑰可用。'
            : res.code === 'network'
              ? '網路連線失敗。請確認網路、VPN 或代理伺服器設定。'
              : res.code === 'timeout'
                ? 'Clone 超過五分鐘仍未完成。'
                : res.code === 'git-not-found'
                  ? '找不到 Git，請先安裝 Git 並重新啟動 Polydesk。'
                  : '';
        setError(prefix ? `${prefix}\n${res.error}` : res.error);
        return;
      }
      await appStore.loadWorkspaces();
      appStore.setActiveWorkspace(res.wsId);
      onResult(res.wsId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clone 失敗。');
    } finally {
      setSubmitting(false);
    }
  };

  const loginAndRetry = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await ipc.git.loginGitHub();
      if ('error' in result) {
        setError(result.error);
        return;
      }
      await submit();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GitHub 登入失敗。');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting && trusted && !!parentPath && !!url && !urlProblem && !!directoryName && !nameProblem;

  return (
    <div style={{ minWidth: 500, maxWidth: 600 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>
        Clone Git Repository
      </h2>

      <Field label="Repository URL" error={urlProblem}>
        <input
          className="pd-input"
          value={url}
          autoFocus
          aria-label="Repository URL"
          placeholder="https://github.com/owner/repository.git"
          onChange={(e) => {
            const next = e.target.value;
            setUrl(next);
            setError(null);
            setNeedsGitHubLogin(false);
            if (!nameEdited) setDirectoryName(cloneDirectoryNameFromUrl(next));
          }}
        />
        <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--meta)', lineHeight: 1.5 }}>
          支援 HTTPS、SSH 與 git@host:path；GitHub 私有 Repository 可用瀏覽器登入，其他主機沿用 Git Credential Manager 或 SSH 設定。
        </p>
      </Field>

      <Field label="存放位置">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="pd-input"
            value={parentPath}
            readOnly
            aria-label="Repository 存放位置"
            placeholder="尚未選擇父資料夾"
            title={parentPath}
            style={{ flex: 1 }}
          />
          <button className="pd-btn" onClick={() => void pickParent()} disabled={submitting} aria-label="選擇存放位置">
            選擇…
          </button>
        </div>
      </Field>

      <Field label="資料夾名稱" error={nameProblem}>
        <input
          className="pd-input"
          value={directoryName}
          aria-label="Clone 目標資料夾名稱"
          placeholder="repository"
          onChange={(e) => {
            setNameEdited(true);
            setDirectoryName(e.target.value);
            setError(null);
          }}
        />
      </Field>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.55 }}>
        <input
          type="checkbox"
          checked={trusted}
          disabled={submitting}
          onChange={(e) => setTrusted(e.target.checked)}
          aria-label="信任此 Repository 來源"
          style={{ marginTop: 3 }}
        />
        <span>我信任此 Repository 的來源。Clone 完成後會直接加入並開啟為可信任工作區。</span>
      </label>

      {submitting && (
        <p role="status" style={{ margin: '14px 0 0', color: 'var(--fg-2)', fontSize: 'var(--text-sm)' }}>
          正在 Clone，請勿關閉 Polydesk…
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: '14px 0 0', color: 'var(--danger)', fontSize: 'var(--text-sm)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {neutralizeBidi(error)}
        </p>
      )}
      {needsGitHubLogin && !submitting && (
        <button className="pd-btn" onClick={() => void loginAndRetry()} aria-label="登入 GitHub 並重試 Clone" style={{ marginTop: 10 }}>
          使用瀏覽器登入 GitHub 並重試
        </button>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="pd-btn" onClick={() => onResult(null)} disabled={submitting} aria-label="取消 Clone Repository">
          取消
        </button>
        <button className="pd-btn pd-btn-primary" onClick={() => void submit()} disabled={!canSubmit} aria-label="Clone 並開啟 Repository">
          {submitting ? 'Clone 中…' : 'Clone 並開啟'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 4 }}>{label}</label>
      {children}
      {error && <p role="alert" style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
