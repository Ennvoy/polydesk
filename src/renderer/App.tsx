// App 外殼（整合接縫，REQ-UI-001）：活動列 + 工作區列表（F-1）+ 可停靠版面 + dialog host + 狀態列。
// 類 VSCode 版面：[ActivityBar | WorkspaceRail | DockLayout]，底部 status bar。

import React from 'react';
import { ActivityBar } from './components/ActivityBar';
import { TitleBar } from './components/TitleBar';
import { DockLayout } from './layout/DockLayout';
import { DialogHost } from './components/Dialogs/host';
import { WorkspaceRail } from './components/WorkspaceRail';
import { RailResizer } from './components/RailResizer';
import { OverviewPanel } from './components/OverviewPanel';
import { railBus } from './state/railBus';
import { useAppState } from './state/appStore';
import { useClaudeCounts } from './state/claudeCounts';
import { ipc } from './ipc/client';
import type { GitStatus } from '../shared/types';

/** 狀態列 git 分支（底部常駐顯示目前分支＋領先/落後，像 VSCode 左下角）。查 git status、訂閱 fs 變動更新；切換工作區以 alive 旗標丟棄 stale。 */
function StatusBarBranch({ wsId }: { wsId: string }): React.JSX.Element | null {
  const [st, setSt] = React.useState<GitStatus | null>(null);
  React.useEffect(() => {
    let alive = true;
    const load = (): void => {
      void ipc.git
        .status({ wsId })
        .then((s) => {
          if (alive) setSt(s);
        })
        .catch(() => {
          if (alive) setSt(null);
        });
    };
    setSt(null);
    load();
    const off = ipc.events.fs.change((p) => {
      if (p.wsId === wsId) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [wsId]);
  if (!st?.isRepo) return null;
  const ahead = st.ahead ?? 0;
  const behind = st.behind ?? 0;
  return (
    <>
      <span style={{ color: 'var(--meta)' }}>·</span>
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        aria-label={`目前分支 ${st.detached ? '分離 HEAD' : (st.branch ?? 'N/A')}，領先 ${ahead}、落後 ${behind}`}
      >
        <span>⎇ {st.detached ? '（分離 HEAD）' : (st.branch ?? 'N/A')}</span>
        {(ahead > 0 || behind > 0) && (
          <span style={{ color: ahead > 0 ? 'var(--accent)' : 'var(--meta)' }} aria-hidden="true">
            ↑{ahead} ↓{behind}
          </span>
        )}
      </span>
    </>
  );
}

function StatusBar(): React.JSX.Element {
  const { workspaces, activeWorkspaceId } = useAppState();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const { running, awaiting } = useClaudeCounts(); // PE-2：多專案 Claude 狀態總覽
  return (
    <footer className="pd-statusbar" aria-label="狀態列">
      <span>Polydesk</span>
      <span style={{ color: 'var(--meta)' }}>·</span>
      <span>{active ? active.name : '未選工作區'}</span>
      {active && <StatusBarBranch wsId={active.id} />}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {running > 0 && (
          <span style={{ color: 'var(--success)' }} aria-label={`${running} 個工作區 Claude 執行中`}>
            {running} 執行中
          </span>
        )}
        {awaiting > 0 && (
          <span style={{ color: 'var(--warn)' }} aria-label={`${awaiting} 個工作區 Claude 待確認`}>
            {awaiting} 待確認
          </span>
        )}
        <span>工作區 {workspaces.length}</span>
      </span>
    </footer>
  );
}

export function App(): React.JSX.Element {
  const [railVisible, setRailVisible] = React.useState(railBus.isVisible());
  React.useEffect(() => railBus.subscribe(setRailVisible), []);
  return (
    <div className="pd-root">
      <TitleBar />
      <div className="pd-shell">
        <ActivityBar />
        {railVisible && <WorkspaceRail />}
        {railVisible && <RailResizer />}
        <div className="pd-shell-main" style={{ position: 'relative' }}>
          <div className="pd-shell-body">
            <DockLayout />
          </div>
          <StatusBar />
          <OverviewPanel />
        </div>
        <DialogHost />
      </div>
    </div>
  );
}
