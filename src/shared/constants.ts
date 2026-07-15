// 跨進程共用常數：逾時值 / 輪詢間隔 / 忽略目錄 / 搜尋上限。

export const APP_NAME = 'Polydesk';
export const STATE_FILE_NAME = 'state.json';

/** watcher / 搜尋預設忽略目錄（REQ-SEARCH-003、REQ-MON-005）。 */
export const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'out', '.vite', 'release', 'coverage'] as const;

/** 背景工作區監控輪詢預設間隔（REQ-MON-005）。 */
export const DEFAULT_BACKGROUND_POLL_MS = 5_000;
/** git 網路類操作逾時（REQ-SCM-007）。 */
export const GIT_NETWORK_TIMEOUT_MS = 30_000;
/** Clone 可能需要下載完整歷史，給予比 pull/push 更長的逾時。 */
export const GIT_CLONE_TIMEOUT_MS = 5 * 60_000;
/** git 本機操作逾時。 */
export const GIT_LOCAL_TIMEOUT_MS = 10_000;
/** PE-4：切工作區自動 fetch 的同工作區冷卻（事件驅動、不背景輪詢；防連切狂觸網）。 */
export const FETCH_COOLDOWN_MS = 60_000;
/** AI 產生 commit message 的引擎呼叫逾時（codex 等 agentic loop 較慢，實測約 45s，給足餘裕）。 */
export const AI_COMMIT_TIMEOUT_MS = 90_000;
/** 餵給 AI 的 staged diff 字元上限（超量截斷，避免 token 爆/變慢；超量時附 --stat 摘要）。 */
export const AI_DIFF_MAX_CHARS = 12_000;
/** 搜尋結果上限（超量截斷，REQ-SEARCH-004）。 */
export const SEARCH_RESULT_LIMIT = 5_000;

/** 終端機字級可調範圍（px）；schema sanitize 與設定 UI 共用同一組上下限。 */
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;
