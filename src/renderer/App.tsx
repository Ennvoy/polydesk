// App 外殼（整合接縫，REQ-UI-001）：活動列 + 工作區列表（F-1）+ 可停靠版面 + dialog host + 狀態列。
// 類 VSCode 版面：[ActivityBar | WorkspaceRail | DockLayout]，底部 status bar。

import React from 'react';
import { ActivityBar } from './components/ActivityBar';
import { TitleBar } from './components/TitleBar';
import { DockLayout } from './layout/DockLayout';
import { DialogHost } from './components/Dialogs/host';
import { WorkspaceRail } from './components/WorkspaceRail';
import { useAppState } from './state/appStore';

function StatusBar(): React.JSX.Element {
  const { workspaces, activeWorkspaceId } = useAppState();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  return (
    <footer className="pd-statusbar" aria-label="狀態列">
      <span>Polydesk</span>
      <span style={{ color: 'var(--meta)' }}>·</span>
      <span>{active ? active.name : '未選工作區'}</span>
      <span style={{ marginLeft: 'auto' }}>工作區 {workspaces.length}</span>
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
