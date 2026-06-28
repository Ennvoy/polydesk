// 缺語言伺服器提示（F-5：REQ-EDIT-005）。非 modal、不阻擋編輯/存檔——固定右下角輕量 toast，
// 提供 [一鍵安裝]（ipc.lsp.install）與 [顯示指令]（installHint）。全用 pd-* class + var(--*) token，
// 每互動元素具 aria-label。刻意以原生 DOM 實作，避免另起 React root；同 langId 不重覆堆疊。

import { ipc } from '../../../ipc/client';
import type { LspServerInfo } from '../../../../shared/types';

const CONTAINER_ID = 'pd-lsp-toasts';
const active = new Set<string>(); // 已顯示中的 langId（避免重覆）

function ensureContainer(): HTMLElement {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', '語言伺服器提示');
    Object.assign(el.style, {
      position: 'fixed',
      right: 'var(--space-4, 16px)',
      bottom: 'var(--space-4, 16px)',
      zIndex: '900', // 低於 dialog（1000+），不蓋彈窗
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2, 8px)',
      maxWidth: '380px',
      pointerEvents: 'none', // 容器不攔截，子 toast 自行開啟
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  return el;
}

function langLabel(langId: string): string {
  const map: Record<string, string> = {
    python: 'Python', go: 'Go', rust: 'Rust', c: 'C', cpp: 'C++', java: 'Java', csharp: 'C#',
  };
  return map[langId] ?? langId;
}

/** 顯示「缺語言伺服器」提示；available 為 true 時不顯示。回傳關閉函式。 */
export function showMissingServerToast(info: LspServerInfo): () => void {
  if (info.available) return () => {};
  const langId = info.langId;
  if (active.has(langId)) return () => {};
  active.add(langId);

  const container = ensureContainer();
  const toast = document.createElement('div');
  toast.className = 'pd-panel';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  Object.assign(toast.style, {
    pointerEvents: 'auto',
    background: 'var(--surface)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md, 8px)',
    boxShadow: 'var(--elev-raised)',
    padding: 'var(--space-3, 12px)',
    fontSize: 'var(--text-sm)',
    lineHeight: '1.5',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2, 8px)',
  } satisfies Partial<CSSStyleDeclaration>);

  const close = (): void => {
    active.delete(langId);
    toast.remove();
    if (container.childElementCount === 0) container.remove();
  };

  const msg = document.createElement('div');
  msg.textContent = `未偵測到 ${langLabel(langId)} 語言伺服器：智慧提示/跳轉暫不可用，編輯與存檔不受影響。`;
  toast.appendChild(msg);

  const row = document.createElement('div');
  row.className = 'pd-row';
  Object.assign(row.style, { display: 'flex', gap: 'var(--space-2, 8px)', justifyContent: 'flex-end' } satisfies Partial<CSSStyleDeclaration>);

  if (info.installable) {
    const installBtn = document.createElement('button');
    installBtn.className = 'pd-btn pd-btn-primary';
    installBtn.textContent = '一鍵安裝';
    installBtn.setAttribute('aria-label', `安裝 ${langLabel(langId)} 語言伺服器`);
    installBtn.addEventListener('click', () => {
      installBtn.disabled = true;
      installBtn.textContent = '安裝中…';
      installBtn.setAttribute('aria-busy', 'true');
      void ipc.lsp
        .install({ langId })
        .then((res) => {
          if ('ok' in res) {
            msg.textContent = `${langLabel(langId)} 語言伺服器已安裝，請重新開啟該檔以啟用。`;
            row.replaceChildren(closeButton(close, '關閉'));
          } else {
            installBtn.disabled = false;
            installBtn.removeAttribute('aria-busy');
            installBtn.textContent = '一鍵安裝';
            showHint(toast, res.manual || info.installHint || '');
          }
        })
        .catch(() => {
          installBtn.disabled = false;
          installBtn.removeAttribute('aria-busy');
          installBtn.textContent = '一鍵安裝';
          showHint(toast, info.installHint || '');
        });
    });
    row.appendChild(installBtn);
  }

  if (info.installHint) {
    const hintBtn = document.createElement('button');
    hintBtn.className = 'pd-btn';
    hintBtn.textContent = '顯示指令';
    hintBtn.setAttribute('aria-label', `顯示 ${langLabel(langId)} 手動安裝指令`);
    hintBtn.addEventListener('click', () => showHint(toast, info.installHint || ''));
    row.appendChild(hintBtn);
  }

  row.appendChild(closeButton(close, '關閉提示'));
  toast.appendChild(row);
  container.appendChild(toast);
  return close;
}

function closeButton(onClick: () => void, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'pd-btn';
  btn.textContent = '關閉';
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', onClick);
  return btn;
}

function showHint(toast: HTMLElement, hint: string): void {
  if (!hint) return;
  let pre = toast.querySelector<HTMLElement>('.pd-lsp-hint');
  if (!pre) {
    pre = document.createElement('code');
    pre.className = 'pd-lsp-hint';
    Object.assign(pre.style, {
      display: 'block',
      background: 'var(--bg-2, var(--bg))',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm, 6px)',
      padding: 'var(--space-2, 8px)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs, 12px)',
      userSelect: 'all',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    } satisfies Partial<CSSStyleDeclaration>);
    toast.insertBefore(pre, toast.lastElementChild);
  }
  pre.textContent = hint;
}
