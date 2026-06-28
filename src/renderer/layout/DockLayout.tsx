// dockview 驅動的可序列化版面（REQ-UI-001/002/003、REQ-PERSIST-003）。
// 預設類 VSCode：左側欄 + 中央編輯區 + 底部終端機；toJSON/fromJSON 持久化、還原失敗 fallback 預設。
// F-10 在此基礎上加顯隱/最大化/一鍵重設 UI；features 不碰本檔。

import { useCallback, useEffect, useRef } from 'react';
import { DockviewReact } from 'dockview-react';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import 'dockview-core/dist/styles/dockview.css';
import { dockviewComponents } from './panelRegistry';
import { useTheme } from '../theme/ThemeProvider';
import { ipc } from '../ipc/client';

// 模組級單例 api，供 F-10 / features 取用（toggle/maximize/reset/開檔聚焦編輯區）。
let layoutApi: DockviewApi | null = null;
export function getLayoutApi(): DockviewApi | null {
  return layoutApi;
}

export function buildDefaultLayout(api: DockviewApi): void {
  api.clear();
  const editor = api.addPanel({ id: 'editor', component: 'editor', title: '編輯器' });
  api.addPanel({
    id: 'sidebar',
    component: 'sidebar',
    title: '側欄',
    position: { direction: 'left', referencePanel: editor.id },
  });
  api.addPanel({
    id: 'terminal',
    component: 'terminal',
    title: '終端機',
    position: { direction: 'below', referencePanel: editor.id },
  });
  // 側欄較窄
  const sidebar = api.getPanel('sidebar');
  sidebar?.api.setSize({ width: 280 });
}

/** 一鍵重設版面回預設（REQ-UI-003，F-10 接 UI）。 */
export function resetLayout(): void {
  if (layoutApi) buildDefaultLayout(layoutApi);
}

export function DockLayout(): React.JSX.Element {
  const { theme } = useTheme();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    layoutApi = api;

    ipc.store
      .getState()
      .then((s) => {
        let restored = false;
        if (s.layout) {
          try {
            api.fromJSON(s.layout as Parameters<DockviewApi['fromJSON']>[0]);
            restored = api.panels.length > 0;
          } catch {
            restored = false;
          }
        }
        if (!restored) buildDefaultLayout(api);
      })
      .catch(() => buildDefaultLayout(api));

    const persist = (): void => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          void ipc.store.setLayout({ layout: api.toJSON() });
        } catch {
          /* 序列化失敗不致命 */
        }
      }, 400);
    };
    api.onDidLayoutChange(persist);
  }, []);

  useEffect(
    () => () => {
      layoutApi = null;
    },
    [],
  );

  const themeClass = theme === 'dark' ? 'dockview-theme-dark' : 'dockview-theme-light';

  return (
    <DockviewReact
      className={`polydesk-dockview ${themeClass}`}
      components={dockviewComponents}
      onReady={onReady}
    />
  );
}
