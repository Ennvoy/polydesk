// 關閉確認（REQ-TERM-007、REQ-E2E-008）：移除工作區 / 關閉 app 前，若該工作區仍有 alive
// 終端機（可能有跑中程序），列出並要求確認，避免誤殺進行中工作（半寫檔 / git index.lock）。
//
// 用法（整合接縫）：
//  - 移除工作區流程（F-1）：`if (!(await confirmCloseWorkspace(wsId, name))) return;` 再呼 workspace:remove。
//  - app 關閉攔截：main 於視窗 close 偵測 alive pty → 推 app:closeRequest → App.tsx 呼 confirmCloseApp
//    彈單一彙總確認（跨工作區列出跑中終端機），核可才呼 window:confirmClose 放行退出。

import React from 'react';
import { ipc } from '../../ipc/client';
import { dialog } from './host';
import type { ShellKind, TermState } from '../../../shared/types';

const SHELL_LABEL: Record<ShellKind, string> = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  pwsh: 'PowerShell 7',
  gitbash: 'Git Bash',
  wsl: 'WSL',
};

function RunningList({ terms }: { terms: TermState[] }): React.JSX.Element {
  return (
    <div>
      <p style={{ margin: '0 0 8px' }}>
        此工作區仍有 {terms.length} 個執行中的終端機，可能有進行中的程序（建置 / 伺服器等）。關閉將強制結束它們。
      </p>
      <ul className="pd-scroll" style={{ margin: 0, paddingLeft: 18, maxHeight: 160, overflowY: 'auto' }}>
        {terms.map((t) => (
          <li key={t.termId} style={{ color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
            {SHELL_LABEL[t.shell] ?? t.shell}
            {t.title && t.title !== t.shell ? ` — ${t.title}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 確認是否可關閉某工作區。無 alive 終端機 → 直接回 true（靜默關閉）；
 * 有 alive 終端機 → 彈窗列出，使用者確認才回 true。
 */
export async function confirmCloseWorkspace(wsId: string, wsName?: string): Promise<boolean> {
  let alive: TermState[] = [];
  try {
    const list = await ipc.pty.list({ wsId });
    alive = list.filter((t) => t.alive);
  } catch {
    // 列舉失敗時不阻擋關閉（保守允許），避免卡死移除流程
    return true;
  }
  if (alive.length === 0) return true;

  return dialog.confirm({
    title: wsName ? `關閉「${wsName}」？` : '關閉工作區？',
    body: <RunningList terms={alive} />,
    confirmText: '仍要關閉',
    cancelText: '取消',
    danger: true,
  });
}

interface WsTerms {
  name: string;
  terms: TermState[];
}

function AppRunningList({ groups }: { groups: WsTerms[] }): React.JSX.Element {
  const total = groups.reduce((n, g) => n + g.terms.length, 0);
  return (
    <div>
      <p style={{ margin: '0 0 8px' }}>
        仍有 {total} 個執行中的終端機，可能有進行中的程序（claude / 建置 / 伺服器等）。退出將強制結束它們。
      </p>
      <ul className="pd-scroll" style={{ margin: 0, paddingLeft: 18, maxHeight: 200, overflowY: 'auto' }}>
        {groups.map((g) =>
          g.terms.map((t) => (
            <li key={t.termId} style={{ color: 'var(--fg-2)', fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
              {g.name} — {SHELL_LABEL[t.shell] ?? t.shell}
              {t.title && t.title !== t.shell ? `（${t.title}）` : ''}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

/**
 * app 關閉前確認（main close 攔截推 app:closeRequest 時呼叫）：跨工作區彙總列出仍 alive 的
 * 終端機，使用者核可才回 true（呼叫端再呼 window:confirmClose 放行退出）。
 * 列舉失敗回 true（保守允許，避免永遠關不掉）。
 */
export async function confirmCloseApp(wsIds: string[]): Promise<boolean> {
  const groups: WsTerms[] = [];
  try {
    const all = await ipc.workspace.list();
    for (const wsId of wsIds) {
      const alive = (await ipc.pty.list({ wsId })).filter((t) => t.alive);
      if (alive.length > 0) {
        groups.push({ name: all.find((w) => w.id === wsId)?.name ?? wsId, terms: alive });
      }
    }
  } catch {
    return true;
  }
  if (groups.length === 0) return true;
  return dialog.confirm({
    title: '關閉 Polydesk？',
    body: <AppRunningList groups={groups} />,
    confirmText: '全部關閉並退出',
    cancelText: '取消',
    danger: true,
  });
}
