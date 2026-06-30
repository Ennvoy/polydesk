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
/** 受監控的 AI 工具（claude 由 hook 狀態檔；codex 由解析其 rollout JSONL）。 */
export type AiTool = 'claude' | 'codex';
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
}
export type WorkspaceInput = { path: string; name?: string };

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
export interface GitLogEntry {
  hash: string;
  author: string;
  date: number;
  subject: string;
  /** parent commit hashes（0=root、1=一般、≥2=merge）；供 commit 線圖 lane 計算。 */
  parents: string[];
  /** commit 訊息 body（標題以外的內文；hover 卡片顯示完整訊息用，PE-1）。 */
  body: string;
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
}

/** 智慧 commit message 的產生引擎。custom＝使用者自訂 argv 範本（任何 CLI；prompt 走 stdin）。 */
export type AiEngine = 'claude' | 'codex' | 'custom';

export interface AiCommitSettings {
  engine: AiEngine;
  /** custom 引擎的 argv 範本（第一元素＝執行檔，其餘為引數；diff/prompt 一律走 stdin，不拼在此）。 */
  customCmd?: string[];
  /** 覆寫內建格式規範 prompt（undefined＝用內建預設 5 條規範）。 */
  promptTemplate?: string;
}

/** 任務指定別名（= PersistState 單一真相）。 */
export type AppState = PersistState;
