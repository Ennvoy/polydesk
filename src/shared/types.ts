// 領域型別單一真相（main / preload / renderer 共用）。
// 任何領域型別變更先改此檔，再改兩端實作（design §3.2）。

export type ThemeId = 'dark' | 'light' | 'warm';
export type ShellKind = 'powershell' | 'cmd' | 'pwsh' | 'gitbash' | 'wsl';
export type FileEncoding = 'utf-8' | 'utf-8-bom' | 'big5' | 'utf-16le' | 'utf-16be';
export type Eol = 'crlf' | 'lf';

/**
 * Claude 執行狀態（REQ-MON-001/002）。精準四態（由 Claude Code hooks 推導，F-8）：
 *  running=執行中（送指令/跑工具/subagent/workflow）、stopped-await=待確認（Notification 權限/問題）、
 *  done=已停止（Stop，整個回合完成沒事做）、idle=未啟動（無 claude session）。
 */
export type ClaudeState = 'running' | 'stopped-await' | 'done' | 'idle';
/**
 * 受監控的 AI 工具清單（main / renderer 共用，新增 provider 時只維護這個順序）。
 * claude 由 hook 狀態檔、codex 由 rollout JSONL、agy 第一版由 Polydesk PTY 下的真實程序判定。
 */
export const AI_TOOLS = ['claude', 'codex', 'agy'] as const;
export type AiTool = (typeof AI_TOOLS)[number];

/** 單一額度視窗：已用百分比 + reset 時間（unix 秒）。 */
export interface RateWindow {
  usedPercent: number;
  resetsAt?: number;
}
/** claude/codex 的用量額度；短期視窗可能依方案或活動不回傳，欄位缺不代表解析失敗。 */
export interface AiUsage {
  claude?: { fiveHour?: RateWindow; sevenDay?: RateWindow };
  codex?: { fiveHour?: RateWindow; sevenDay?: RateWindow; planType?: string };
}

export interface ClaudeStatus {
  state: ClaudeState;
  pid?: number;
  /** PTY 輸出活動時間戳（strip ANSI 後）。 */
  lastActivityAt?: number;
  /** 剛結束時的 exit code。 */
  exitCode?: number;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  order: number;
  status: 'ok' | 'missing';
  defaultShell: ShellKind;
  trusted: boolean;
  /** 該工作區 Playwright user-data-dir（相對 userData）。 */
  profileDir: string;
  /** lazy 實體化狀態（執行期，不持久化）。 */
  hydrated: boolean;
  /**
   * worktree 標記（REQ-WT-003）：存在＝此工作區是 git worktree。只持久化主工作樹路徑
   * （`git rev-parse --git-common-dir` 推出）；分支名顯示時即時查（git worktree list），不存死值。
   */
  worktree?: { mainPath: string };
}
export type WorkspaceInput = { path: string; name?: string };

/** Clone repository 的輸入與可供 UI 分流的錯誤碼。 */
export interface GitCloneInput {
  url: string;
  /** 使用者選定的既有父資料夾；clone 會在其下建立 directoryName。 */
  parentPath: string;
  directoryName: string;
}
export type GitCloneErrorCode =
  | 'invalid-url'
  | 'invalid-parent'
  | 'invalid-name'
  | 'target-exists'
  | 'auth'
  | 'network'
  | 'timeout'
  | 'git-not-found'
  | 'failed';
export type GitCloneResult =
  | { wsId: string; path: string }
  | { error: string; code: GitCloneErrorCode };

/** git worktree 清單項（REQ-WT-008；`git worktree list --porcelain -z` 解析）。 */
export interface GitWorktree {
  path: string;
  /** detached HEAD → null。 */
  branch: string | null;
  head: string;
  /** 主工作樹（porcelain 首筆）。 */
  isMain: boolean;
  /** 失效登記（資料夾已不存在，可 prune）。 */
  prunable: boolean;
  /** 已納管為 Polydesk 工作區時的 wsId（handler 附加）。 */
  managedWsId?: string;
}

/** 無 remote/upstream/detached/新分支未 push → 對應欄位 null（顯示 N/A，REQ-MON-003）。 */
export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  changedCount: number;
  detached: boolean;
}
export interface GitChange {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  staged: boolean;
}
/** commit 上的 ref 裝飾（線圖徽章：本地/遠端分支位置、tag、分離 HEAD，like VSCode Graph）。 */
export interface GitLogRef {
  /** 顯示名：main、origin/main、v1.0、HEAD（detached）。 */
  name: string;
  kind: 'local' | 'remote' | 'tag' | 'detached';
  /** HEAD 目前指著這個 ref（＝簽出中的本地分支）。 */
  head: boolean;
}
export interface GitLogEntry {
  hash: string;
  author: string;
  date: number;
  subject: string;
  /** parent commit hashes（0=root、1=一般、≥2=merge）；供 commit 線圖 lane 計算。 */
  parents: string[];
  /** commit 訊息 body（標題以外的內文；hover 卡片顯示完整訊息用，PE-1）。 */
  body: string;
  /** 指著此 commit 的 refs（%D 解析；無＝[]）。 */
  refs: GitLogRef[];
}

export interface TermState {
  termId: string;
  wsId: string;
  shell: ShellKind;
  title: string;
  alive: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  col: number;
  preview: string;
  /** 'file' ＝檔名命中（preview 為 basename、line/col 固定 1）；未給＝內容命中。 */
  kind?: 'file';
}

export interface LspServerInfo {
  langId: string;
  available: boolean;
  command?: string;
  installable: boolean;
  installHint?: string;
}

/** Playwright 接線結果（REQ-PW-002）。 */
export interface McpWireResult {
  ok: boolean;
  serverName: 'polydesk-pw';
  registered: boolean;
  conflict?: ConflictInfo;
  error?: string;
}
export interface ConflictInfo {
  existingName: string;
  reason: 'same-name' | 'same-kind';
}

/** dockview toJSON() 序列化產物（結構由 dockview 定義，視為 opaque）。 */
export type LayoutJson = unknown;

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

/** 持久化根狀態（design §5 schema）。 */
export interface PersistState {
  schemaVersion: number;
  theme: ThemeId;
  /** hydrated 不持久化。 */
  workspaces: Omit<Workspace, 'hydrated'>[];
  layout: LayoutJson | null;
  openFiles: { wsId: string; path: string }[];
  /** 配置記憶（不保證復活程序，REQ-PERSIST-003）。 */
  terminals: { wsId: string; shell: ShellKind }[];
  /** 視窗位置/大小持久化（REQ-PERSIST-003）。 */
  windowBounds?: WindowBounds;
  /** 工作區 rail 寬度（px）持久化；undefined＝用 CSS 預設 --rail-w。 */
  railWidth?: number;
  /** 智慧 commit message 引擎設定（undefined＝預設 claude）。 */
  aiCommit?: AiCommitSettings;
  /** 終端機字型（undefined＝預設 Consolas 14）。 */
  terminalFont?: TerminalFontSettings;
}

/** 終端機字型設定（undefined＝預設 Consolas 14，對齊 VS Code Windows 預設）。 */
export interface TerminalFontSettings {
  /** 首選字型名（CSS font-family 首位；後備鏈固定由 renderer 補）。 */
  family: string;
  /** 字級 px（TERMINAL_FONT_SIZE_MIN–MAX）。 */
  size: number;
}

/** 智慧 commit message 的產生引擎。custom＝使用者自訂 argv 範本（任何 CLI；prompt 走 stdin）。 */
export type AiEngine = 'claude' | 'codex' | 'agy' | 'custom';

export interface AiCommitSettings {
  engine: AiEngine;
  /** custom 引擎的 argv 範本（第一元素＝執行檔，其餘為引數；diff/prompt 一律走 stdin，不拼在此）。 */
  customCmd?: string[];
  /** 覆寫內建格式規範 prompt（undefined＝用內建預設 5 條規範）。 */
  promptTemplate?: string;
}

/** 任務指定別名（= PersistState 單一真相）。 */
export type AppState = PersistState;
