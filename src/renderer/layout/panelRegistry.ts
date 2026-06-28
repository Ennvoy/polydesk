// 面板槽位登錄表（design §1.3）：features 註冊各自的 view/editor/terminal 實作，
// 未註冊則顯示 placeholder。dockview 的 components 由本檔的 host 提供（features 不碰 DockLayout）。

import React, { useSyncExternalStore } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { useAppState } from '../state/appStore';

export type SlotComponent = React.FC;

// 槽位 id：側欄三視圖 + 編輯區 + 終端機（features 以這些 key 註冊）。
export const SLOT = {
  viewExplorer: 'view:explorer',
  viewSearch: 'view:search',
  viewScm: 'view:scm',
  editor: 'editor',
  terminal: 'terminal',
} as const;

const registry = new Map<string, SlotComponent>();
const subs = new Set<() => void>();
let version = 0;

export function registerPanel(id: string, comp: SlotComponent): void {
  registry.set(id, comp);
  version++;
  for (const s of subs) s();
}

function useRegistryVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => version,
  );
}

const PlaceholderText: Record<string, string> = {
  [SLOT.viewExplorer]: '檔案總管（待 F-2）',
  [SLOT.viewSearch]: '全域搜尋（待 F-6）',
  [SLOT.viewScm]: '原始碼控制（待 F-7）',
  [SLOT.editor]: '編輯器（待 F-4）— 從檔案總管開檔',
  [SLOT.terminal]: '終端機（待 F-3）— 「＋」開啟',
};

function Placeholder({ slot }: { slot: string }): React.JSX.Element {
  return React.createElement(
    'div',
    {
      style: {
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--meta)',
        fontSize: 'var(--text-sm)',
        padding: 'var(--space-6)',
        textAlign: 'center',
      },
    },
    PlaceholderText[slot] ?? slot,
  );
}

/** 渲染某槽位已註冊的元件，未註冊則 placeholder（late registration 會自動重繪）。 */
function Slot({ slot }: { slot: string }): React.JSX.Element {
  useRegistryVersion();
  const Comp = registry.get(slot);
  return Comp ? React.createElement(Comp) : React.createElement(Placeholder, { slot });
}

/** 側欄 host：依活動列選中的視圖渲染對應槽位。 */
function SidebarHost(_props: IDockviewPanelProps): React.JSX.Element {
  const { activeView } = useAppState();
  const slot =
    activeView === 'search' ? SLOT.viewSearch : activeView === 'scm' ? SLOT.viewScm : SLOT.viewExplorer;
  return React.createElement(Slot, { slot });
}

function EditorHost(_props: IDockviewPanelProps): React.JSX.Element {
  return React.createElement(Slot, { slot: SLOT.editor });
}

function TerminalHost(_props: IDockviewPanelProps): React.JSX.Element {
  return React.createElement(Slot, { slot: SLOT.terminal });
}

/** 傳給 DockviewReact 的固定 components（panel 名 → host）。 */
export const dockviewComponents: Record<string, React.FC<IDockviewPanelProps>> = {
  sidebar: SidebarHost,
  editor: EditorHost,
  terminal: TerminalHost,
};
