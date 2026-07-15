// 發佈到 GitHub 對話框（DF-12）：repo 名稱＋公開/私有 → gh CLI 建 repo＋加 origin＋push。
// 認證全在 gh 的系統 keyring，Polydesk 不碰 token；錯誤依 code 給人話引導（比照 CloneRepositoryDialog）。

import React, { useState } from 'react';
import { ipc } from '../../ipc/client';
import { publishRepoNameError, defaultRepoName } from '../../../shared/gitPublish';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';
import type { GitPublishResult } from '../../../shared/types';

function errorText(res: Extract<GitPublishResult, { error: string }>): string {
  const prefix =
    res.code === 'gh-not-found'
      ? '找不到 GitHub CLI（gh）。請先安裝：winget install GitHub.cli，安裝後重新啟動 Polydesk。'
      : res.code === 'gh-not-authed'
        ? 'GitHub CLI 尚未登入。請在終端機執行 gh auth login 完成登入後再試一次。'
        : res.code === 'name-exists'
          ? '這個名稱在你的 GitHub 帳號已存在，請換一個名稱。'
          : res.code === 'network'
            ? '網路連線失敗。請確認網路、VPN 或代理伺服器設定。'
            : res.code === 'timeout'
              ? '發佈超過五分鐘仍未完成。'
              : '';
  return prefix ? `${prefix}\n${res.error}` : res.error;
}

export function PublishGitHubDialog({
  wsId,
  wsName,
  onClose,
}: {
  wsId: string;
  wsName: string;
  onClose: (published: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState(defaultRepoName(wsName));
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

  const nameProblem = name ? publishRepoNameError(name) : null;

  const submit = async (): Promise<void> => {
    const nErr = publishRepoNameError(name);
    if (nErr) {
      setError(nErr);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await ipc.git.publishGitHub({ wsId, name: name.trim(), visibility });
      if ('error' in res) {
        setError(errorText(res));
        return;
      }
      setDoneUrl(res.url || `https://github.com/（已建立：${name.trim()}）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '發佈失敗。');
    } finally {
      setSubmitting(false);
    }
  };

  if (doneUrl !== null) {
    return (
      <div style={{ minWidth: 460, maxWidth: 560 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>已發佈到 GitHub</h2>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-2)', lineHeight: 1.6, wordBreak: 'break-all' }}>
          遠端 repository 已建立、origin 已設定、目前分支已推送：
          <br />
          <span style={{ color: 'var(--accent)' }}>{neutralizeBidi(doneUrl)}</span>
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="pd-btn pd-btn-primary" onClick={() => onClose(true)} aria-label="完成發佈">
            完成
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: 460, maxWidth: 560 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>發佈到 GitHub</h2>
      <p style={{ margin: '0 0 16px', fontSize: 'var(--text-sm)', color: 'var(--fg-2)', lineHeight: 1.55 }}>
        以 GitHub CLI（gh）在你的帳號建立 repository、設定 origin 並推送目前分支。認證由 gh 保管，Polydesk 不儲存任何 token。
      </p>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--fg-2)', marginBottom: 4 }}>
          Repository 名稱
        </label>
        <input
          className="pd-input"
          value={name}
          autoFocus
          aria-label="GitHub Repository 名稱"
          placeholder="my-repo"
          disabled={submitting}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          style={{ width: '100%' }}
        />
        {nameProblem && (
          <p role="alert" style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
            {nameProblem}
          </p>
        )}
      </div>

      <fieldset style={{ border: 'none', margin: '0 0 6px', padding: 0 }} disabled={submitting}>
        <legend style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-2)', marginBottom: 4 }}>可見性</legend>
        {(
          [
            ['private', '私有（Private）— 只有你與受邀者看得到'],
            ['public', '公開（Public）— 任何人都看得到'],
          ] as const
        ).map(([v, label]) => (
          <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--fg-2)', padding: '2px 0' }}>
            <input
              type="radio"
              name="pd-publish-visibility"
              checked={visibility === v}
              onChange={() => setVisibility(v)}
              aria-label={label}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {submitting && (
        <p role="status" style={{ margin: '14px 0 0', color: 'var(--fg-2)', fontSize: 'var(--text-sm)' }}>
          正在建立 GitHub repository 並推送，請勿關閉 Polydesk…
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: '14px 0 0', color: 'var(--danger)', fontSize: 'var(--text-sm)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {neutralizeBidi(error)}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="pd-btn" onClick={() => onClose(false)} disabled={submitting} aria-label="取消發佈">
          取消
        </button>
        <button
          className="pd-btn pd-btn-primary"
          onClick={() => void submit()}
          disabled={submitting || !name || !!nameProblem}
          aria-label="建立 GitHub repository 並推送"
        >
          {submitting ? '發佈中…' : '建立並推送'}
        </button>
      </div>
    </div>
  );
}
