// 跨進程共用常數：逾時值 / 輪詢間隔 / 忽略目錄 / ANSI 調色盤（design §1.4、§5）。

export const APP_NAME = 'Polydesk';
export const STATE_FILE_NAME = 'state.json';

/** watcher / 搜尋預設忽略目錄（REQ-SEARCH-003、REQ-MON-005）。 */
export const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'out', '.vite', 'release', 'coverage'] as const;

/** 背景工作區監控輪詢預設間隔（REQ-MON-005）。 */
export const DEFAULT_BACKGROUND_POLL_MS = 5_000;
/** git 網路類操作逾時（REQ-SCM-007）。 */
export const GIT_NETWORK_TIMEOUT_MS = 30_000;
/** git 本機操作逾時。 */
export const GIT_LOCAL_TIMEOUT_MS = 10_000;
/** 搜尋結果上限（超量截斷，REQ-SEARCH-004）。 */
export const SEARCH_RESULT_LIMIT = 5_000;

/**
 * 16 色 ANSI 調色盤（每主題一組，與設計 token 協調，REQ-TERM 用）。
 * 骨架值，終端機 task 可再對齊 tokens.css 微調。
 */
export const ANSI_PALETTE: Record<'dark' | 'light' | 'warm', readonly string[]> = {
  dark: [
    '#0a0a0a', '#e5484d', '#46a758', '#f5d90a', '#0070f3', '#bf7af0', '#3db9cf', '#ededed',
    '#7d7d7d', '#ff6369', '#5dba6f', '#ffe629', '#52a9ff', '#d19dff', '#5fd4e8', '#ffffff',
  ],
  light: [
    '#1a1a1a', '#dc2626', '#16a34a', '#ca8a04', '#0070f3', '#9333ea', '#0891b2', '#171717',
    '#6b7280', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#06b6d4', '#000000',
  ],
  warm: [
    '#141413', '#b53333', '#17a34a', '#b8860b', '#c96442', '#9a6c9a', '#3a8fa0', '#3d3d3a',
    '#87867f', '#cc5a3a', '#3cb371', '#d4a017', '#d4754f', '#b387b3', '#4fa3b3', '#faf9f5',
  ],
};
