// 活動列（REQ-UI-001）：切換側欄視圖（檔案/搜尋/原始碼控制）+ 開設定。
// 深層客製化（自畫，不吃框架預設）；每鈕含 aria-label + 可見 focus（X-3 再強化）。

import React from 'react';
import { appStore, useAppState, type ActivityView } from '../state/appStore';
import { ipc } from '../ipc/client';
import { dialog } from './Dialogs/host';
import { SettingsPanel } from './Settings/SettingsPanel';

interface Item {
  view: ActivityView;
  label: string;
  icon: React.ReactNode;
}

const I = {
  files: (
    <path d="M4 4h6l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  scm: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M8.4 7.3A6 6 0 0 1 15.5 9" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
};

const ITEMS: Item[] = [
  { view: 'explorer', label: '檔案總管', icon: I.files },
  { view: 'search', label: '搜尋', icon: I.search },
  { view: 'scm', label: '原始碼控制', icon: I.scm },
];

function IconButton(props: {
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const badgeText = props.badge && props.badge > 99 ? '99+' : String(props.badge ?? '');
  const title = props.badge ? `${props.label}（${props.badge} 個未提交變更）` : props.label;
  return (
    <button
      className={`pd-activity-btn${props.active ? ' is-active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.active}
      title={title}
      onClick={props.onClick}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {props.children}
      </svg>
      {props.badge ? (
        <span className="pd-activity-badge" aria-hidden="true" data-testid="scm-change-count">
          {badgeText}
        </span>
      ) : null}
    </button>
  );
}

export function ActivityBar(): React.JSX.Element {
  const { activeView, activeWorkspaceId } = useAppState();
  const [scmChangeCount, setScmChangeCount] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = (): void => {
      if (!activeWorkspaceId) {
        setScmChangeCount(0);
        return;
      }
      const gen = ++generation;
      void ipc.git
        .status({ wsId: activeWorkspaceId })
        .then((status) => {
          if (alive && gen === generation) setScmChangeCount(status.isRepo ? status.changedCount : 0);
        })
        .catch(() => {
          if (alive && gen === generation) setScmChangeCount(0);
        });
    };

    // 切換工作區時先清掉前一個數字；短暫防抖避免快速掠過多個工作區時堆積 git status。
    setScmChangeCount(0);
    timer = setTimeout(load, 120);
    const off = ipc.events.fs.change(({ wsId }) => {
      if (wsId !== activeWorkspaceId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 300);
    });
    return () => {
      alive = false;
      generation += 1;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [activeWorkspaceId]);

  return (
    <nav className="pd-activitybar" aria-label="活動列">
      <div className="pd-activity-group">
        {ITEMS.map((it) => (
          <IconButton
            key={it.view}
            label={it.label}
            active={activeView === it.view}
            badge={it.view === 'scm' ? scmChangeCount : undefined}
            onClick={() => appStore.setActiveView(it.view)}
          >
            {it.icon}
          </IconButton>
        ))}
      </div>
      <div className="pd-activity-group">
        <IconButton label="設定" onClick={() => void dialog.open((close) => <SettingsPanel onClose={() => close()} />)}>
          {I.gear}
        </IconButton>
      </div>
    </nav>
  );
}
