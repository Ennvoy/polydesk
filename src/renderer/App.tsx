// App 外殼（整合接縫，REQ-UI-001）：活動列 + 工作區列表（F-1）+ 可停靠版面 + dialog host + 狀態列。
// 類 VSCode 版面：[ActivityBar | WorkspaceRail | DockLayout]，底部 status bar。

import React from 'react';
import { ActivityBar } from './components/ActivityBar';
import { TitleBar } from './components/TitleBar';
import { DockLayout } from './layout/DockLayout';
import { DialogHost } from './components/Dialogs/host';
import { WorkspaceRail } from './components/WorkspaceRail';
import { useAppState } from './state/appStore';
import { useClaudeCounts } from './state/claudeCounts';

function StatusBar(): React.JSX.Element {
  const { workspaces, activeWorkspaceId } = useAppState();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const { running, awaiting } = useClaudeCounts(); // PE-2：多專案 Claude 狀態總覽
  return (
    <footer className="pd-statusbar" aria-label="狀態列">
      <span>Polydesk</span>
      <span style={{ color: 'var(--meta)' }}>·</span>
      <span>{active ? active.name : '未選工作區'}</span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {running > 0 && (
          <span style={{ color: 'var(--success)' }} aria-label={`${running} 個工作區 Claude 執行中`}>
            {running} 執行中
          </span>
        )}
        {awaiting > 0 && (
          <span style={{ color: 'var(--warn)' }} aria-label={`${awaiting} 個工作區 Claude 待接手`}>
            {awaiting} 待接手
          </span>
        )}
        <span>工作區 {workspaces.length}</span>
      </span>
    </footer>
  );
}

export function App(): React.JSX.Element {
  return (
    <div className="pd-root">
      <TitleBar />
      <div className="pd-shell">
        <ActivityBar />
        <WorkspaceRail />
        <div className="pd-shell-main">
          <div className="pd-shell-body">
            <DockLayout />
          </div>
          <StatusBar />
        </div>
        <DialogHost />
      </div>
    </div>
  );
}
