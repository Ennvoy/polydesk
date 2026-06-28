// WorkspaceRail — Wave 1 placeholder（F-1 將以完整實作覆蓋：新增/切換/改名/刪除/拖曳排序
// + 空狀態歡迎頁 + 信任確認 + Claude 徽章）。本檔僅讓外殼 build 綠並可展示版面。

import React from 'react';
import { useAppState } from '../state/appStore';

export function WorkspaceRail(): React.JSX.Element {
  const { workspaces } = useAppState();
  return (
    <aside
      className="pd-rail"
      aria-label="工作區列表"
      style={{
        width: 'var(--rail-w)',
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="pd-panel-header">工作區</div>
      <div style={{ padding: 'var(--space-4)', color: 'var(--meta)', fontSize: 'var(--text-sm)' }}>
        {workspaces.length === 0 ? '尚無工作區（F-1 將加入新增/切換）' : `${workspaces.length} 個工作區`}
      </div>
    </aside>
  );
}
