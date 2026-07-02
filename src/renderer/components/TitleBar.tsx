// 自訂無框標題列（frame:false；REQ-UI-001 風格一致）：品牌 + 檔案/編輯/檢視 自訂選單 +
// 可拖曳區（-webkit-app-region）+ 自畫 min/max/close。深層客製化、深色一致，取代撞風格的原生選單列。
// 選單動作只接「不繞過安全流程」的：設定/結束、編輯剪貼簿(execCommand)、檢視版面切換（重用 DockLayout 匯出）。

import React, { useEffect, useRef, useState } from 'react';
import { ipc } from '../ipc/client';
import { dialog } from './Dialogs/host';
import { SettingsPanel } from './Settings/SettingsPanel';
import { resetLayout, toggleLayoutPanel, toggleTerminalMax } from '../layout/DockLayout';

interface MenuItem {
  label: string;
  onClick?: () => void;
  separator?: boolean;
}
interface MenuDef {
  label: string;
  items: MenuItem[];
}

/** 剪貼簿/復原等走 execCommand（best-effort：作用於目前聚焦的輸入；Monaco 有自身快捷鍵）。 */
const exec = (cmd: string) => (): void => {
  try {
    document.execCommand(cmd);
  } catch {
    /* 不支援則忽略 */
  }
};

export function TitleBar(): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  // 最大化狀態：初始查詢 + 訂閱變動（OS 快捷鍵/雙擊也會變）。
  useEffect(() => {
    void ipc.window.isMaximized().then((r) => setMaximized(r.maximized));
    return ipc.events.window.maximizedChange((p) => setMaximized(p.maximized));
  }, []);

  // 點選單外 / 按 Esc → 關閉。
  useEffect(() => {
    if (!openMenu) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const openSettings = (): void => void dialog.open((close) => <SettingsPanel onClose={() => close()} />);

  const menus: MenuDef[] = [
    {
      label: '檔案',
      items: [
        { label: '設定…', onClick: openSettings },
        { label: '', separator: true },
        { label: '結束', onClick: () => void ipc.window.close() },
      ],
    },
    {
      label: '編輯',
      items: [
        { label: '復原', onClick: exec('undo') },
        { label: '重做', onClick: exec('redo') },
        { label: '', separator: true },
        { label: '剪下', onClick: exec('cut') },
        { label: '複製', onClick: exec('copy') },
        { label: '貼上', onClick: exec('paste') },
      ],
    },
    {
      label: '檢視',
      items: [
        { label: '切換側欄', onClick: () => toggleLayoutPanel('sidebar') },
        { label: '切換編輯器', onClick: () => toggleLayoutPanel('editor') },
        { label: '切換終端機', onClick: () => toggleLayoutPanel('terminal') },
        { label: '最大化／還原終端機', onClick: () => toggleTerminalMax() },
        { label: '', separator: true },
        { label: '重設版面', onClick: () => resetLayout() },
      ],
    },
  ];

  const onItemClick = (item: MenuItem): void => {
    setOpenMenu(null);
    item.onClick?.();
  };

  return (
    <header className="pd-titlebar" ref={barRef} aria-label="標題列">
      <div className="pd-titlebar-brand">
        <svg className="pd-titlebar-logo" width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
          {/* Polydesk 疊層星芒：三個三角 currentColor + 不同透明度，隨 --accent 主題換色 */}
          <polygon points="50,20 22,72 78,72" fill="currentColor" opacity="0.95" />
          <polygon points="24,28 80,44 44,80" fill="currentColor" opacity="0.6" />
          <polygon points="76,30 56,80 20,50" fill="currentColor" opacity="0.45" />
        </svg>
        <span className="pd-titlebar-title">Polydesk</span>
      </div>

      <nav className="pd-titlebar-menus" aria-label="主選單">
        {menus.map((menu) => (
          <div key={menu.label} className="pd-titlebar-menu">
            <button
              type="button"
              className={`pd-titlebar-menubtn${openMenu === menu.label ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.label}
              onClick={() => setOpenMenu((m) => (m === menu.label ? null : menu.label))}
              onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="pd-titlebar-dropdown" role="menu" aria-label={menu.label}>
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <div key={i} className="pd-titlebar-sep" role="separator" />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      className="pd-titlebar-item"
                      onClick={() => onItemClick(item)}
                    >
                      {item.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="pd-titlebar-drag" />

      <div className="pd-titlebar-controls">
        <button
          type="button"
          className="pd-titlebar-ctl"
          aria-label="最小化視窗"
          title="最小化"
          onClick={() => void ipc.window.minimize()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="pd-titlebar-ctl"
          aria-label={maximized ? '還原視窗' : '最大化視窗'}
          title={maximized ? '還原' : '最大化'}
          onClick={() => void ipc.window.maximizeToggle()}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
              <rect x="2.5" y="3.5" width="6" height="6" />
              <path d="M4.5 3.5V2.5h5v5h-1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
              <rect x="2.5" y="2.5" width="7" height="7" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="pd-titlebar-ctl pd-titlebar-close"
          aria-label="關閉視窗"
          title="關閉"
          onClick={() => void ipc.window.close()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </button>
      </div>
    </header>
  );
}
