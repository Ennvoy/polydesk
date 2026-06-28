// 領域型別單一真相（main / preload / renderer 共用）。
// 任何領域型別變更先改此檔，再改兩端實作（design §3.2）。

export type ThemeId = 'dark' | 'light' | 'warm';
export type ShellKind = 'powershell' | 'cmd' | 'pwsh' | 'gitbash' | 'wsl';
export type FileEncoding = 'utf-8' | 'utf-8-bom' | 'big5' | 'utf-16le' | 'utf-16be';
export type Eol = 'crlf' | 'lf';

/** Claude 執行狀態（REQ-MON-001/002）：執行中 / 已停待接手 / 未啟動。 */
export type ClaudeState = 'running' | 'stopped-await' | 'idle';
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
}

/** 任務指定別名（= PersistState 單一真相）。 */
export type AppState = PersistState;
