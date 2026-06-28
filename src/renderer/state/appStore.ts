// 跨 feature 共用的 renderer UI 狀態（最小外部 store，useSyncExternalStore 訂閱）。
// 持有：工作區清單、目前作用工作區、活動列選中的視圖。features 經此讀寫共享狀態，
// 避免 prop drilling，且與 IPC 單一真相對齊（workspaces 來自 main）。

import { useSyncExternalStore } from 'react';
import { ipc } from '../ipc/client';
import type { Workspace } from '../../shared/types';

export type ActivityView = 'explorer' | 'search' | 'scm';

export interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeView: ActivityView;
}

let state: AppState = { workspaces: [], activeWorkspaceId: null, activeView: 'explorer' };
const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const appStore = {
  getState: (): AppState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** 從 main 載入工作區清單，校正 activeWorkspaceId（被刪則改選第一個）。 */
  async loadWorkspaces(): Promise<Workspace[]> {
    const ws = await ipc.workspace.list();
    let active = state.activeWorkspaceId;
    if (active && !ws.some((w) => w.id === active)) active = null;
    if (!active && ws.length) active = ws[0].id;
    setState({ workspaces: ws, activeWorkspaceId: active });
    return ws;
  },
  setWorkspaces(ws: Workspace[]): void {
    setState({ workspaces: ws });
  },
  /** 切換作用工作區（觸發 main lazy 實體化）。 */
  setActiveWorkspace(id: string | null): void {
    setState({ activeWorkspaceId: id });
    if (id) void ipc.workspace.activate({ wsId: id });
  },
  setActiveView(v: ActivityView): void {
    setState({ activeView: v });
  },
  activeWorkspace(): Workspace | null {
    return state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null;
  },
};

/** 訂閱整個 app state（state 參照僅在變更時更新，故不會無限重繪）。 */
export function useAppState(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState);
}
