// 持久化 schema 版本 + 遷移鏈 + 預設狀態 + 正規化（design §5.3、REQ-PERSIST-004）。

import type { PersistState, ThemeId } from '../../shared/types';

export const CURRENT_SCHEMA_VERSION = 1;

const THEMES: readonly ThemeId[] = ['dark', 'light', 'warm'];

export function defaultState(): PersistState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme: 'dark',
    workspaces: [],
    layout: null,
    openFiles: [],
    terminals: [],
    windowBounds: undefined,
  };
}

type AnyState = Record<string, unknown>;
type Migration = (s: AnyState) => AnyState;

/** 版本→版本遷移函式鏈（key = 來源版本）。 */
const MIGRATIONS: Record<number, Migration> = {
  // v0（無版本欄位的早期狀態）→ v1：補上 schemaVersion，欄位由 normalize 補齊。
  0: (s) => ({ ...s, schemaVersion: 1 }),
};

/**
 * 把任意讀入物件遷移到 CURRENT 版本並正規化。
 * - 非物件 / 未來版本（> CURRENT）/ 無遷移路徑 → throw（由呼叫端轉成「備份壞檔 + 預設啟動」）。
 */
export function migrate(raw: unknown): PersistState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('state 不是物件');
  }
  let s = raw as AnyState;
  let version = typeof s.schemaVersion === 'number' ? s.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`未知（未來）schemaVersion ${version}`);
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) throw new Error(`無 schemaVersion ${version} 的遷移路徑`);
    s = m(s);
    version = typeof s.schemaVersion === 'number' ? s.schemaVersion : version + 1;
  }
  return normalize(s);
}

/** 以預設值補齊缺漏 / 型別不符的欄位（防半損毀狀態）。 */
function normalize(s: AnyState): PersistState {
  const d = defaultState();
  const theme = THEMES.includes(s.theme as ThemeId) ? (s.theme as ThemeId) : d.theme;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme,
    workspaces: Array.isArray(s.workspaces) ? (s.workspaces as PersistState['workspaces']) : d.workspaces,
    layout: 'layout' in s ? (s.layout as PersistState['layout']) : d.layout,
    openFiles: Array.isArray(s.openFiles) ? (s.openFiles as PersistState['openFiles']) : d.openFiles,
    terminals: Array.isArray(s.terminals) ? (s.terminals as PersistState['terminals']) : d.terminals,
    windowBounds: (s.windowBounds as PersistState['windowBounds']) ?? d.windowBounds,
  };
}
