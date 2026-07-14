// 持久化 schema 版本 + 遷移鏈 + 預設狀態 + 正規化（design §5.3、REQ-PERSIST-004）。

import type { PersistState, TerminalFontSettings, ThemeId } from '../../shared/types';
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '../../shared/constants';

export const CURRENT_SCHEMA_VERSION = 2;

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
    railWidth: undefined,
    aiCommit: undefined,
    terminalFont: undefined,
  };
}

type AnyState = Record<string, unknown>;
type Migration = (s: AnyState) => AnyState;

/** 版本→版本遷移函式鏈（key = 來源版本）。 */
const MIGRATIONS: Record<number, Migration> = {
  // v0（無版本欄位的早期狀態）→ v1：補上 schemaVersion，欄位由 normalize 補齊。
  0: (s) => ({ ...s, schemaVersion: 1 }),
  // v1 → v2：新增 Workspace.worktree? 標記（第二迭代）。既有工作區不帶＝非 worktree，
  // 逐筆 sanitize 由 normalize 的 sanitizeWorkspaces 負責（不在此塞欄位）。
  1: (s) => ({ ...s, schemaVersion: 2 }),
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

/** aiCommit 設定容錯：須為物件且 engine 是合法值，否則退預設。 */
function isValidAiCommit(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const e = (v as { engine?: unknown }).engine;
  return e === 'claude' || e === 'codex' || e === 'agy' || e === 'custom';
}

/**
 * 終端機字型設定容錯（setTerminalFont 與 normalize 共用）：family 剝引號防 CSS font-family
 * 拼裝壞格式、截 64 字防灌爆；size 非有限數整筆拒收、超界收斂到上下限。無效 → undefined（＝用預設）。
 */
export function sanitizeTerminalFont(v: unknown): TerminalFontSettings | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.family !== 'string' || typeof o.size !== 'number' || !Number.isFinite(o.size)) return undefined;
  const family = o.family.replace(/["']/g, '').trim().slice(0, 64);
  if (!family) return undefined;
  const size = Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(o.size)));
  return { family, size };
}

const SHELLS = ['powershell', 'cmd', 'pwsh', 'gitbash', 'wsl'];

/**
 * 逐筆 sanitize workspaces（紅軍 A4）：竄改的 state.json 不得靠半損毀筆繞過信任或讓 list()/git crash。
 * - 必要欄位（id/name/path 字串、order 數）缺或型別錯 → 整筆剔除。
 * - trusted 只認 boolean true（字串 'true' 不當真）。
 * - worktree 僅接受 { mainPath: 非空字串 }，否則丟棄該欄（不讓半損毀標記留存）。
 */
function sanitizeWorkspaces(raw: unknown): PersistState['workspaces'] {
  if (!Array.isArray(raw)) return [];
  const out: PersistState['workspaces'] = [];
  for (const w of raw) {
    if (typeof w !== 'object' || w === null) continue;
    const o = w as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.path !== 'string') continue;
    if (typeof o.order !== 'number') continue;
    const wt =
      typeof o.worktree === 'object' &&
      o.worktree !== null &&
      typeof (o.worktree as Record<string, unknown>).mainPath === 'string' &&
      ((o.worktree as Record<string, unknown>).mainPath as string).trim() !== ''
        ? { mainPath: (o.worktree as { mainPath: string }).mainPath }
        : undefined;
    out.push({
      id: o.id,
      name: o.name,
      path: o.path,
      order: o.order,
      status: o.status === 'missing' ? 'missing' : 'ok',
      defaultShell: (SHELLS.includes(o.defaultShell as string) ? o.defaultShell : 'powershell') as PersistState['workspaces'][number]['defaultShell'],
      trusted: o.trusted === true,
      profileDir: typeof o.profileDir === 'string' ? o.profileDir : `pw-profiles/${o.id}`,
      ...(wt ? { worktree: wt } : {}),
    });
  }
  return out;
}

/** 以預設值補齊缺漏 / 型別不符的欄位（防半損毀狀態）。 */
function normalize(s: AnyState): PersistState {
  const d = defaultState();
  const theme = THEMES.includes(s.theme as ThemeId) ? (s.theme as ThemeId) : d.theme;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme,
    workspaces: sanitizeWorkspaces(s.workspaces),
    layout: 'layout' in s ? (s.layout as PersistState['layout']) : d.layout,
    openFiles: Array.isArray(s.openFiles) ? (s.openFiles as PersistState['openFiles']) : d.openFiles,
    terminals: Array.isArray(s.terminals) ? (s.terminals as PersistState['terminals']) : d.terminals,
    windowBounds: (s.windowBounds as PersistState['windowBounds']) ?? d.windowBounds,
    railWidth: typeof s.railWidth === 'number' ? s.railWidth : d.railWidth,
    aiCommit: isValidAiCommit(s.aiCommit) ? (s.aiCommit as PersistState['aiCommit']) : d.aiCommit,
    terminalFont: sanitizeTerminalFont(s.terminalFont),
  };
}
