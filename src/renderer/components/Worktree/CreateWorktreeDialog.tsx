// 建立 worktree 對話框（F-11；REQ-WT-001②/002/005/010/011/013）。
// 三來源（現有本地分支／新分支＋起點／remote 分支）、互斥禁選＋送出前即時複查、路徑預覽可改、
// 進行中 spinner 防重入、失敗依 code 給友善訊息（net→重試）。純邏輯在 worktreeModel（已單測）。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ipc } from '../../ipc/client';
import { appStore } from '../../state/appStore';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';
import {
  branchNameError,
  buildBranchSpec,
  checkedOutBranches,
  previewTargetPath,
  type BranchSourceKind,
} from './worktreeModel';
import { makeCreateAction, friendlyCreateError } from './worktreeSubmit';
import type { GitWorktree } from '../../../shared/types';

interface Props {
  /** 來源 repo 工作區（主工作樹或其 worktree 皆可，main 端解回主工作樹）。 */
  wsId: string;
  wsPath: string;
  /** 預填分支（入口③「在新 worktree 開啟」帶入既有分支）。 */
  presetBranch?: string;
  onResult: (createdWsId: string | null) => void;
}

const LABEL: Record<BranchSourceKind, string> = {
  existing: '現有本地分支',
  new: '新分支',
  remote: 'remote 分支',
};

export function CreateWorktreeDialog({ wsId, wsPath, presetBranch, onResult }: Props): React.JSX.Element {
  const [kind, setKind] = useState<BranchSourceKind>(presetBranch ? 'existing' : 'new');
  const [locals, setLocals] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('');
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(true);

  const [existing, setExisting] = useState(presetBranch ?? '');
  const [newName, setNewName] = useState('');
  const [base, setBase] = useState('');
  const [remoteRef, setRemoteRef] = useState('');

  const [pathEdited, setPathEdited] = useState(false);
  const [pathValue, setPathValue] = useState('');
  // 主工作樹路徑（sibling 基準）：從 worktree list 的 isMain 取；未載入前退回 wsPath。
  // 修：在 worktree 工作區中建立時，基準須是「主 repo」而非作用中的 worktree，否則會巢狀成
  // <main>-worktrees/<dev>-worktrees/<new>（REQ-WT-003 主工作樹收斂）。
  const [mainPath, setMainPath] = useState(wsPath);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ msg: string; retry: boolean } | null>(null);

  // 載入分支/worktree 清單（互斥判斷用）。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [b, wt] = await Promise.all([
        ipc.git.branch({ wsId, op: 'list' }),
        ipc.git.worktreeList({ wsId }),
      ]);
      if (!alive) return;
      if ('branches' in b) {
        setLocals(b.branches);
        setRemotes(b.remotes ?? []);
        setCurrent(b.current);
        setBase(b.current); // 新分支起點預設當前分支（D-WT-BRANCH-BASE）
      }
      if ('list' in wt) {
        setWorktrees(wt.list);
        const main = wt.list.find((x) => x.isMain);
        if (main) setMainPath(main.path); // sibling 基準＝主工作樹（非作用中的 worktree）
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [wsId]);

  const excluded = useMemo(() => checkedOutBranches(worktrees), [worktrees]);

  // slug 來源：依 kind 取當前分支名，算預覽路徑（未手動編輯才自動更新）。
  const slugSource = useMemo(() => {
    if (kind === 'existing') return existing;
    if (kind === 'new') return newName;
    const idx = remoteRef.indexOf('/');
    return idx >= 0 ? remoteRef.slice(idx + 1) : remoteRef;
  }, [kind, existing, newName, remoteRef]);

  useEffect(() => {
    if (!pathEdited) setPathValue(slugSource ? previewTargetPath(mainPath, slugSource) : '');
  }, [slugSource, pathEdited, mainPath]);

  const newNameErr = kind === 'new' && newName ? branchNameError(newName) : null;

  // 送出動作（防重入 + 送出前重抓複查在此，紅軍 A2/A3）——整個對話框生命週期共用一個實例。
  const createRef = useRef(
    makeCreateAction({
      worktreeList: (id) => ipc.git.worktreeList({ wsId: id }),
      worktreeAdd: (args) => ipc.git.worktreeAdd(args),
    }),
  );

  const submit = async (): Promise<void> => {
    setError(null);
    const spec = buildBranchSpec(kind, { existing, newName, base, remoteRef });
    if ('error' in spec) {
      setError({ msg: spec.error, retry: false });
      return;
    }
    setSubmitting(true);
    try {
      const r = await createRef.current({ wsId, branch: spec.branch, path: pathValue });
      if (r.kind === 'ignored') return; // 併發重複點擊：忽略
      if (r.kind === 'ok') {
        await appStore.loadWorkspaces();
        appStore.setActiveWorkspace(r.wsId);
        onResult(r.wsId);
        return;
      }
      if (r.kind === 'conflict') {
        setError({
          msg: `分支「${r.branch}」已被其他 worktree 或主 repo 簽出（${r.at}）。請選其他分支或改用「跳到該 worktree」。`,
          retry: false,
        });
        return;
      }
      const { msg, retry } = friendlyCreateError(r.code, r.message);
      setError({ msg, retry });
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : '建立失敗', retry: true });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting &&
    !loading &&
    pathValue.trim() !== '' &&
    (kind === 'existing' ? existing !== '' : kind === 'new' ? !!newName && !newNameErr : remoteRef !== '');

  return (
    <div style={{ minWidth: 460, maxWidth: 560 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>
        ⎇ 從 Git 分支建立 worktree
      </h2>

      {/* 來源 repo（唯讀顯示，來自發起工作區） */}
      <Field label="來源 repo">
        <div className="pd-input" style={{ opacity: 0.8 }} title={wsPath}>
          {neutralizeBidi(wsPath)}
        </div>
      </Field>

      {/* 分支來源三選一 */}
      <Field label="分支來源">
        <div role="radiogroup" aria-label="分支來源" style={{ display: 'flex', gap: 12 }}>
          {(['existing', 'new', 'remote'] as BranchSourceKind[]).map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
              <input type="radio" name="wt-kind" checked={kind === k} onChange={() => setKind(k)} aria-label={LABEL[k]} />
              {LABEL[k]}
            </label>
          ))}
        </div>
      </Field>

      {kind === 'existing' && (
        <Field label="選擇分支">
          <select
            className="pd-input"
            value={existing}
            aria-label="現有本地分支"
            disabled={loading}
            onChange={(e) => setExisting(e.target.value)}
          >
            <option value="">（請選擇）</option>
            {locals.map((b) => {
              const taken = excluded.has(b);
              return (
                <option key={b} value={b} disabled={taken}>
                  {b}
                  {taken ? '（已簽出於其他 worktree）' : ''}
                </option>
              );
            })}
          </select>
        </Field>
      )}

      {kind === 'new' && (
        <>
          <Field label="新分支名" error={newNameErr}>
            <input
              className="pd-input"
              value={newName}
              autoFocus
              aria-label="新分支名"
              aria-invalid={!!newNameErr}
              placeholder="feat/my-feature"
              onChange={(e) => setNewName(e.target.value)}
            />
          </Field>
          <Field label="起點分支">
            <select className="pd-input" value={base} aria-label="起點分支" onChange={(e) => setBase(e.target.value)}>
              {!locals.includes(current) && current && <option value={current}>{current}（目前）</option>}
              {locals.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {b === current ? '（目前）' : ''}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {kind === 'remote' && (
        <Field label="remote 分支">
          <select
            className="pd-input"
            value={remoteRef}
            aria-label="remote 分支"
            disabled={loading}
            onChange={(e) => setRemoteRef(e.target.value)}
          >
            <option value="">（請選擇）</option>
            {remotes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {remotes.length === 0 && !loading && (
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--meta)' }}>
              無 remote 分支（尚未 fetch 或無 remote）。
            </p>
          )}
        </Field>
      )}

      {/* 目標路徑（預設 sibling，可改） */}
      <Field label="建立位置">
        <input
          className="pd-input"
          value={pathValue}
          aria-label="worktree 建立位置"
          onChange={(e) => {
            setPathEdited(true);
            setPathValue(e.target.value);
          }}
        />
        <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--meta)' }}>
          預設放在 repo 旁的 <code>-worktrees</code> 資料夾，可改。
        </p>
      </Field>

      {error && (
        <p role="alert" style={{ margin: '12px 0 0', color: 'var(--danger)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
          {neutralizeBidi(error.msg)}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="pd-btn" onClick={() => onResult(null)} aria-label="取消建立 worktree" disabled={submitting}>
          取消
        </button>
        <button
          className="pd-btn pd-btn-primary"
          onClick={() => void submit()}
          disabled={!canSubmit}
          aria-label={error?.retry ? '重試建立 worktree' : '建立並開啟工作區'}
        >
          {submitting ? '建立中…' : error?.retry ? '重試' : '建立並開啟工作區'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 4 }}>
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
