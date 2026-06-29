// dockview 驅動的可序列化版面（REQ-UI-001/002/003、REQ-PERSIST-003）。
// 預設類 VSCode：左側欄 + 中央編輯區 + 底部終端機；toJSON/fromJSON 持久化、還原失敗 fallback 預設。
// F-10 在此基礎上加：顯隱（側欄/終端機）、終端機可逆最大化、一鍵重設，與合併結構持久化（layoutPersist）。
// features 不碰本檔；所有顯隱/最大化判定一律以 dockview 為單一真相（見 layoutPersist 紅軍註解）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { DockviewReact } from 'dockview-react';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import 'dockview-core/dist/styles/dockview.css';
import { dockviewComponents } from './panelRegistry';
import { useTheme } from '../theme/ThemeProvider';
import { ipc } from '../ipc/client';
import {
  LayoutPersistController,
  deriveToolbarState,
  deriveUiState,
  deserialize,
  serialize,
  toggleTerminalMaximize,
  togglePanel,
  type LayoutUiState,
  type ToolbarState,
} from './layoutPersist';

// panel id 單一真相（顯隱/最大化判定一律以這些 id 對 dockview getPanel）。
const SIDEBAR_ID = 'sidebar';
const TERMINAL_ID = 'terminal';
const EDITOR_ID = 'editor';
const TOGGLEABLE: readonly string[] = [SIDEBAR_ID, EDITOR_ID, TERMINAL_ID];

// 模組級單例 api，供 F-10 / features 取用（toggle/maximize/reset/開檔聚焦編輯區）。
let layoutApi: DockviewApi | null = null;
export function getLayoutApi(): DockviewApi | null {
  return layoutApi;
}

// ── 各可切換 panel 的重建器（顯示時依此重加，封裝位置/尺寸；先 getPanel 去重防 duplicate id）──
function addSidebar(api: DockviewApi): void {
  if (api.getPanel(SIDEBAR_ID)) return;
  const ref = api.getPanel(EDITOR_ID) ?? api.panels[0];
  const panel = ref
    ? api.addPanel({
        id: SIDEBAR_ID,
        component: 'sidebar',
        title: '側欄',
        position: { direction: 'left', referencePanel: ref.id },
      })
    : api.addPanel({ id: SIDEBAR_ID, component: 'sidebar', title: '側欄' });
  panel.api.setSize({ width: 280 });
}

function addTerminal(api: DockviewApi): void {
  if (api.getPanel(TERMINAL_ID)) return;
  const ref = api.getPanel(EDITOR_ID) ?? api.panels[0];
  if (ref) {
    api.addPanel({
      id: TERMINAL_ID,
      component: 'terminal',
      title: '終端機',
      position: { direction: 'below', referencePanel: ref.id },
    });
  } else {
    api.addPanel({ id: TERMINAL_ID, component: 'terminal', title: '終端機' });
  }
}

function addEditor(api: DockviewApi): void {
  if (api.getPanel(EDITOR_ID)) return;
  // 編輯器重新顯示：擺在側欄右側（無側欄則接在現有第一個 panel 旁，再無則獨立）。
  const ref = api.getPanel(SIDEBAR_ID) ?? api.panels[0];
  if (ref) {
    api.addPanel({
      id: EDITOR_ID,
      component: 'editor',
      title: '編輯器',
      position: { direction: 'right', referencePanel: ref.id },
    });
  } else {
    api.addPanel({ id: EDITOR_ID, component: 'editor', title: '編輯器' });
  }
}

export function buildDefaultLayout(api: DockviewApi): void {
  api.clear();
  const editor = api.addPanel({ id: EDITOR_ID, component: 'editor', title: '編輯器' });
  api.addPanel({
    id: SIDEBAR_ID,
    component: 'sidebar',
    title: '側欄',
    position: { direction: 'left', referencePanel: editor.id },
  });
  api.addPanel({
    id: TERMINAL_ID,
    component: 'terminal',
    title: '終端機',
    position: { direction: 'below', referencePanel: editor.id },
  });
  // 側欄較窄
  const sidebar = api.getPanel(SIDEBAR_ID);
  sidebar?.api.setSize({ width: 280 });
}

/**
 * 一鍵重設版面回預設（REQ-UI-003，F-10 接 UI）。
 * 關鍵：不 api.clear() 重建（那會 dispose 編輯器/終端機 component → 開啟的檔與終端機 PTY/內容全消失）；
 * 改為「補齊被隱藏的面板 + 把既有面板移回預設相對位置」（moveTo 只搬 group、不 dispose），保住工作狀態。
 */
export function resetLayout(): void {
  const api = layoutApi;
  if (!api) return;
  // 1. 退出任何最大化（最大化態下 move 行為不可預期）。
  try {
    api.exitMaximizedGroup();
  } catch {
    /* 無最大化 */
  }
  // 2. 補齊預設三面板（被隱藏/不存在者加回；既有者保留＝不 dispose → 保住編輯器開檔 + 終端機 session/內容）。
  if (!api.getPanel(EDITOR_ID)) addEditor(api);
  if (!api.getPanel(SIDEBAR_ID)) addSidebar(api);
  if (!api.getPanel(TERMINAL_ID)) addTerminal(api);
  if (!api.getPanel(EDITOR_ID)) return;
  // 2b. 確保三面板都「可見」（被 toggle 以 setVisible(false) 隱藏的 group 顯示回來）。
  for (const id of TOGGLEABLE) {
    try {
      api.getPanel(id)?.api.group.api.setVisible(true);
    } catch {
      /* 設可見失敗不致命 */
    }
  }
  // 3. 重排回預設相對位置（moveTo 只搬 group、不 dispose component）：sidebar 左、terminal 下。
  try {
    const sidebar = api.getPanel(SIDEBAR_ID);
    const editorGroup1 = api.getPanel(EDITOR_ID)?.api.group;
    if (sidebar && editorGroup1) sidebar.api.moveTo({ group: editorGroup1, position: 'left' });
    const terminal = api.getPanel(TERMINAL_ID);
    const editorGroup2 = api.getPanel(EDITOR_ID)?.api.group;
    if (terminal && editorGroup2) terminal.api.moveTo({ group: editorGroup2, position: 'bottom' });
  } catch {
    /* 重排失敗：至少三面板都在（不致命，使用者可手動拖動）。 */
  }
  // 4. 側欄寬度回預設。
  api.getPanel(SIDEBAR_ID)?.api.setSize({ width: 280 });
}

/** 供標題列「檢視」選單切換面板顯隱（toolbar 視覺態經 dockview onDidLayoutChange 自動 re-sync）。 */
export function toggleLayoutPanel(which: 'sidebar' | 'editor' | 'terminal'): void {
  const api = layoutApi;
  if (!api) return;
  if (which === 'sidebar') togglePanel(api, SIDEBAR_ID, () => addSidebar(api));
  else if (which === 'editor') togglePanel(api, EDITOR_ID, () => addEditor(api));
  else togglePanel(api, TERMINAL_ID, () => addTerminal(api));
}

/** 供標題列「檢視」選單切換終端機最大化。 */
export function toggleTerminalMax(): void {
  if (layoutApi) toggleTerminalMaximize(layoutApi, TERMINAL_ID);
}

/** A2/A3：還原時套用 UI 狀態—依 hidden 以 setVisible(false) 隱藏（不 dispose，保住 component），再依 maximized 最大化終端機。 */
function applyUi(api: DockviewApi, ui: LayoutUiState): void {
  for (const id of ui.hidden) {
    const p = api.getPanel(id);
    if (p) {
      try {
        p.api.group.api.setVisible(false);
      } catch {
        /* 隱藏失敗不致命 */
      }
    }
  }
  if (ui.maximized) {
    const t = api.getPanel(TERMINAL_ID);
    if (t) {
      try {
        if (!t.api.isMaximized()) t.api.maximize();
      } catch {
        /* 還原最大化失敗：退回非最大化但保留所有 panel */
      }
    }
  }
}

export function DockLayout(): React.JSX.Element {
  const { theme } = useTheme();
  const controllerRef = useRef<LayoutPersistController | null>(null);
  const [toolbar, setToolbar] = useState<ToolbarState>({
    sidebarVisible: true,
    editorVisible: true,
    terminalVisible: true,
    maximized: false,
  });

  // A1：工具列視覺態一律由 dockview getPanel 推導（非獨立 boolean），避免狀態機去同步。
  const syncToolbar = useCallback(() => {
    const api = layoutApi;
    if (!api) return;
    setToolbar(deriveToolbarState(api, { sidebar: SIDEBAR_ID, editor: EDITOR_ID, terminal: TERMINAL_ID }));
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      layoutApi = api;

      const controller = new LayoutPersistController((env) => {
        try {
          void ipc.store.setLayout({ layout: env });
        } catch {
          /* 送出失敗不致命 */
        }
      });
      controllerRef.current = controller;

      // A5：還原期間吞掉 fromJSON/buildDefaultLayout 的事件風暴，避免初始多餘寫入與覆寫競態。
      controller.beginRestore();
      ipc.store
        .getState()
        .then((s) => {
          // A2/A4：解析合併 envelope（含 legacy 純樹），layout 未過驗證回 null → 走預設不 brick。
          const { layout, ui } = deserialize(s.layout);
          let restored = false;
          if (layout) {
            try {
              api.fromJSON(layout);
              restored = api.panels.length > 0;
            } catch {
              restored = false;
            }
          }
          if (!restored) buildDefaultLayout(api);
          applyUi(api, ui);
          syncToolbar();
        })
        .catch(() => {
          buildDefaultLayout(api);
          syncToolbar();
        })
        .finally(() => {
          controller.endRestore();
        });

      const persist = (): void => {
        controller.schedule(serialize(api.toJSON(), deriveUiState(api, TOGGLEABLE, TERMINAL_ID)));
      };
      // 任一版面變動 / 最大化變動：去抖存合併結構 + 同步工具列態。
      api.onDidLayoutChange(() => {
        persist();
        syncToolbar();
      });
      api.onDidMaximizedGroupChange(() => {
        persist();
        syncToolbar();
      });
    },
    [syncToolbar],
  );

  // A5：視窗關閉前 flush 去抖（避免去抖視窗內關閉丟失最新版面）；卸載時也 flush + 清理。
  useEffect(() => {
    const flush = (): void => controllerRef.current?.flush();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      controllerRef.current?.flush();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      layoutApi = null;
    };
  }, []);

  const onToggleSidebar = useCallback(() => {
    const api = layoutApi;
    if (!api) return;
    togglePanel(api, SIDEBAR_ID, () => addSidebar(api));
    syncToolbar();
  }, [syncToolbar]);

  const onToggleEditor = useCallback(() => {
    const api = layoutApi;
    if (!api) return;
    togglePanel(api, EDITOR_ID, () => addEditor(api));
    syncToolbar();
  }, [syncToolbar]);

  const onToggleTerminal = useCallback(() => {
    const api = layoutApi;
    if (!api) return;
    togglePanel(api, TERMINAL_ID, () => addTerminal(api));
    syncToolbar();
  }, [syncToolbar]);

  const onToggleMaximize = useCallback(() => {
    const api = layoutApi;
    if (!api) return;
    toggleTerminalMaximize(api, TERMINAL_ID);
    syncToolbar();
  }, [syncToolbar]);

  const onReset = useCallback(() => {
    resetLayout();
    syncToolbar();
  }, [syncToolbar]);

  const themeClass = theme === 'dark' ? 'dockview-theme-dark' : 'dockview-theme-light';

  return (
    <div
      className="pd-docklayout"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <div
        className="pd-panel-header pd-docklayout-toolbar"
        role="toolbar"
        aria-label="版面控制"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', textTransform: 'none' }}
      >
        <button
          type="button"
          className={`pd-btn${toolbar.sidebarVisible ? ' pd-btn-primary' : ''}`}
          aria-label="切換側欄顯示"
          aria-pressed={toolbar.sidebarVisible}
          title="顯示/隱藏側欄"
          onClick={onToggleSidebar}
          style={toolbarBtnStyle}
        >
          側欄
        </button>
        <button
          type="button"
          className={`pd-btn${toolbar.editorVisible ? ' pd-btn-primary' : ''}`}
          aria-label="切換編輯器顯示"
          aria-pressed={toolbar.editorVisible}
          title="顯示/隱藏編輯器"
          onClick={onToggleEditor}
          style={toolbarBtnStyle}
        >
          編輯器
        </button>
        <button
          type="button"
          className={`pd-btn${toolbar.terminalVisible ? ' pd-btn-primary' : ''}`}
          aria-label="切換終端機顯示"
          aria-pressed={toolbar.terminalVisible}
          title="顯示/隱藏終端機"
          onClick={onToggleTerminal}
          style={toolbarBtnStyle}
        >
          終端機
        </button>
        <button
          type="button"
          className={`pd-btn${toolbar.maximized ? ' pd-btn-primary' : ''}`}
          aria-label="最大化終端機"
          aria-pressed={toolbar.maximized}
          title="最大化/還原終端機"
          disabled={!toolbar.terminalVisible}
          onClick={onToggleMaximize}
          style={toolbarBtnStyle}
        >
          最大化終端機
        </button>
        <button
          type="button"
          className="pd-btn"
          aria-label="重設版面"
          title="重設為預設版面"
          onClick={onReset}
          style={{ ...toolbarBtnStyle, marginLeft: 'auto' }}
        >
          重設版面
        </button>
      </div>

      <div className="pd-docklayout-body" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <DockviewReact
          className={`polydesk-dockview ${themeClass}`}
          components={dockviewComponents}
          onReady={onReady}
        />
      </div>
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  padding: '2px 10px',
};
