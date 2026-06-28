// 共用 dialog host（design S3/S9/S10/S11）：單一掛載點 + 命令式 API。
// features 經 dialog.open/confirm 開彈窗，不各自實作 overlay；支援疊多層、Esc 取消。

import React, { useCallback, useEffect, useSyncExternalStore } from 'react';

type CloseFn = (result?: unknown) => void;
export type ModalRender = (close: CloseFn) => React.ReactNode;

interface ModalEntry {
  key: number;
  render: ModalRender;
  resolve: (v: unknown) => void;
  dismissable: boolean;
}

let stack: ModalEntry[] = [];
let keySeq = 0;
const subs = new Set<() => void>();
function emit(): void {
  for (const s of subs) s();
}

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export const dialog = {
  /** 開一個自訂 modal，回傳 Promise（close(result) 時 resolve）。 */
  open(render: ModalRender, opts?: { dismissable?: boolean }): Promise<unknown> {
    return new Promise((resolve) => {
      stack = [...stack, { key: ++keySeq, render, resolve, dismissable: opts?.dismissable ?? true }];
      emit();
    });
  },
  /** 關閉最上層 modal。 */
  close(result?: unknown): void {
    const top = stack[stack.length - 1];
    if (!top) return;
    stack = stack.slice(0, -1);
    emit();
    top.resolve(result);
  },
  /** 確認框：回傳 boolean。 */
  confirm(opts: ConfirmOptions): Promise<boolean> {
    return dialog.open((close) =>
      React.createElement(ConfirmDialog, { ...opts, onResult: (v: boolean) => close(v) }),
    ).then((v) => v === true);
  },
};

function ConfirmDialog(props: ConfirmOptions & { onResult: (v: boolean) => void }): React.JSX.Element {
  return (
    <div style={{ minWidth: 360, maxWidth: 480 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)' }}>
        {props.title}
      </h2>
      {props.body && <div style={{ color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{props.body}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="pd-btn" onClick={() => props.onResult(false)} aria-label={props.cancelText ?? '取消'}>
          {props.cancelText ?? '取消'}
        </button>
        <button
          className={props.danger ? 'pd-btn pd-btn-danger' : 'pd-btn pd-btn-primary'}
          onClick={() => props.onResult(true)}
          aria-label={props.confirmText ?? '確認'}
          autoFocus
        >
          {props.confirmText ?? '確認'}
        </button>
      </div>
    </div>
  );
}

export function DialogHost(): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => stack,
    () => stack,
  );

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const top = stack[stack.length - 1];
      if (top?.dismissable) dialog.close(undefined);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  if (snapshot.length === 0) return null;

  return (
    <>
      {snapshot.map((entry, i) => (
        <div
          key={entry.key}
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000 + i,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && entry.dismissable) dialog.close(undefined);
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              color: 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--elev-raised)',
              padding: 'var(--space-6)',
            }}
          >
            {entry.render(dialog.close)}
          </div>
        </div>
      ))}
    </>
  );
}
