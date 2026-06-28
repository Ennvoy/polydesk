// 關閉確認（REQ-TERM-007、REQ-E2E-008）：移除工作區 / 關閉 app 前，若該工作區仍有 alive
// 終端機（可能有跑中程序），列出並要求確認，避免誤殺進行中工作（半寫檔 / git index.lock）。
//
// 用法（整合接縫）：
//  - 移除工作區流程（F-1）：`if (!(await confirmCloseWorkspace(wsId, name))) return;` 再呼 workspace:remove。
//  - app 關閉攔截：main `before-quit` 通知 renderer 對每個有 alive pty 的工作區跑本確認，全允才退出。

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
