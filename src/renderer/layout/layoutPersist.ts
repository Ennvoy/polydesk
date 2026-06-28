// 版面持久化輔助（F-10，REQ-PERSIST-003）：把 dockview 序列化樹 + 自訂 UI 狀態（顯隱/最大化）
// 合併成單一 envelope 落檔，並提供「不受信任輸入」的驗證閘門與去抖/還原競態控制。
//
// 設計原則（紅軍對應）：
//  - A1：顯隱/最大化「以 dockview 為單一真相」—togglePanel/ensurePanel 一律先 getPanel 再決定，
//        addPanel 前去重避免 'duplicate panel id'，視覺態由 deriveToolbarState 直接從 getPanel 推導。
//  - A2：序列化「合併結構」—serialize 同時寫 layout 與 ui；deserialize round-trip 還原兩者（含 legacy 純樹）。
//  - A3：最大化用 dockview 原生可逆 API（panel.api.maximize/exitMaximized），絕不 removePanel('editor')。
//  - A4：fromJSON 前先 validateLayout（結構/panel 數/巢狀深度/尺寸有限正數），超大字串拒存。
//  - A5：LayoutPersistController 提供 restoring guard（還原期間吞掉事件風暴）與 flush（卸載前送出最新）。
//
// 純函式 + 結構化介面（DockApiLike / PanelLike）→ node 環境可單元測試（真實演算法、非 mock 被測邏輯）。

import type { SerializedDockview } from 'dockview';

// ── 限額（A4：不受信任 layout 注入 / 資源耗盡防線）──
export const LAYOUT_LIMITS = {
  /** panel 數上限（超過視為異常/惡意）。 */
  maxPanels: 50,
  /** grid 樹巢狀深度上限。 */
  maxDepth: 8,
  /** 序列化 envelope 位元組上限（>256KB 拒存回，避免每次拖曳同步 fsync 巨檔造成主程序 DoS）。 */
  maxBytes: 256 * 1024,
} as const;

// ── envelope 結構（A2：layout + ui 合併單一真相）──
export interface LayoutUiState {
  /** 使用者主動隱藏（可重新顯示）的 panel id。 */
  hidden: string[];
  /** 終端機是否最大化。 */
  maximized: boolean;
}

export interface PersistedLayout {
  kind: 'polydesk-layout';
  version: 1;
  layout: SerializedDockview;
  ui: LayoutUiState;
}

export const DEFAULT_UI: LayoutUiState = { hidden: [], maximized: false };

// ── dockview api 的最小結構介面（真實 DockviewApi 結構相容；測試可注入 fake-但-真演算法）──
export interface PanelLike {
  readonly id: string;
  readonly api: {
    isMaximized(): boolean;
    maximize(): void;
    exitMaximized(): void;
  };
}

export interface DockApiLike {
  getPanel(id: string): PanelLike | undefined;
  removePanel(panel: PanelLike): void;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 有限且非負（拒 NaN / Infinity / 負值）。 */
function isFiniteNonNeg(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// ── A4：grid 樹遞迴驗證（型別、巢狀深度、尺寸有限正數）──
function validateNode(node: unknown, depth: number): boolean {
  if (depth > LAYOUT_LIMITS.maxDepth) return false;
  if (!isObj(node)) return false;
  if (node.type !== 'leaf' && node.type !== 'branch') return false;
  // size 為選填，但出現時必須有限非負（擋 NaN/負值半殘 layout）。
  if (node.size !== undefined && !isFiniteNonNeg(node.size)) return false;
  if (node.type === 'branch') {
    if (!Array.isArray(node.data)) return false;
    for (const child of node.data) {
      if (!validateNode(child, depth + 1)) return false;
    }
    return true;
  }
  // leaf：data 為 group view state 物件。
  return isObj(node.data);
}

/**
 * A4：驗證不受信任的 dockview 序列化樹是否「結構健全」。未過視為損毀，呼叫端走 buildDefaultLayout。
 * 檢查：物件 / grid.root 物件 / grid 尺寸有限非負 / panels 為非空 Record 且數量 ≤ 上限 / 樹深度與尺寸合法。
 */
export function validateLayout(json: unknown): json is SerializedDockview {
  if (!isObj(json)) return false;
  const grid = json.grid;
  if (!isObj(grid)) return false;
  if (!isObj(grid.root)) return false;
  if (!isFiniteNonNeg(grid.width) || !isFiniteNonNeg(grid.height)) return false;
  const panels = json.panels;
  if (!isObj(panels)) return false;
  const panelCount = Object.keys(panels).length;
  if (panelCount === 0 || panelCount > LAYOUT_LIMITS.maxPanels) return false;
  return validateNode(grid.root, 1);
}

/** 序列化大小（UTF-8 位元組）；無法序列化（循環引用等）回 Infinity。 */
export function serializedSize(value: unknown): number {
  let str: string;
  try {
    str = JSON.stringify(value);
  } catch {
    return Infinity;
  }
  if (typeof str !== 'string') return Infinity;
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return str.length;
}

/** A4：envelope 是否在大小上限內（超過拒存回，避免巨檔同步寫入造成卡頓）。 */
export function withinSizeLimit(value: unknown): boolean {
  return serializedSize(value) <= LAYOUT_LIMITS.maxBytes;
}

function normalizeUi(ui: unknown): LayoutUiState {
  if (!isObj(ui)) return { ...DEFAULT_UI };
  const hidden = Array.isArray(ui.hidden) ? ui.hidden.filter((x): x is string => typeof x === 'string') : [];
  return { hidden, maximized: ui.maximized === true };
}

/** A2：把 dockview 樹與 UI 狀態合併成單一可落檔 envelope。 */
export function serialize(layout: SerializedDockview, ui: LayoutUiState): PersistedLayout {
  return { kind: 'polydesk-layout', version: 1, layout, ui: normalizeUi(ui) };
}

/**
 * A2 + A4：解析持久化原始值。支援新 envelope 與 legacy 純 dockview 樹；layout 未過驗證回 null
 * （呼叫端據此走 buildDefaultLayout 不 brick）。ui 永遠回正規化後的安全值。
 */
export function deserialize(raw: unknown): { layout: SerializedDockview | null; ui: LayoutUiState } {
  if (!isObj(raw)) return { layout: null, ui: { ...DEFAULT_UI } };
  // 新 envelope。
  if (raw.kind === 'polydesk-layout') {
    const ui = normalizeUi(raw.ui);
    const layout = validateLayout(raw.layout) ? raw.layout : null;
    return { layout, ui };
  }
  // legacy：raw 本身就是 dockview 序列化樹。
  if (validateLayout(raw)) return { layout: raw, ui: { ...DEFAULT_UI } };
  return { layout: null, ui: { ...DEFAULT_UI } };
}

function safeIsMaximized(panel: PanelLike): boolean {
  try {
    return panel.api.isMaximized();
  } catch {
    return false;
  }
}

/**
 * A1：以 dockview 為單一真相切換 panel 顯隱。存在→移除（隱藏）；不存在→重加（顯示）。
 * 回傳切換後是否「可見」。add 由呼叫端提供（封裝重建位置/尺寸），內部仍 ensurePanel 去重防 duplicate id。
 */
export function togglePanel(api: DockApiLike, id: string, add: () => void): boolean {
  const existing = api.getPanel(id);
  if (existing) {
    api.removePanel(existing);
    return false;
  }
  ensurePanel(api, id, add);
  return true;
}

/** A1：僅在不存在時才 add（去重，擋重複提交/雙擊造成的 'duplicate panel id'）。回傳是否真的新增。 */
export function ensurePanel(api: DockApiLike, id: string, add: () => void): boolean {
  if (api.getPanel(id)) return false;
  add();
  return true;
}

/**
 * A3：終端機最大化以 dockview 原生可逆 API 達成（絕不 removePanel('editor')）。
 * 回傳切換後是否為最大化；終端機不存在則 no-op 回 false。
 */
export function toggleTerminalMaximize(api: DockApiLike, terminalId: string): boolean {
  const t = api.getPanel(terminalId);
  if (!t) return false;
  if (safeIsMaximized(t)) {
    try {
      t.api.exitMaximized();
    } catch {
      /* 還原失敗不致命 */
    }
    return false;
  }
  try {
    t.api.maximize();
  } catch {
    return false;
  }
  return true;
}

/** A2：從現況 api 推導要落檔的 UI 狀態（hidden = 可切換但目前不存在的；maximized = 目標 panel 已最大化）。 */
export function deriveUiState(
  api: DockApiLike,
  toggleableIds: readonly string[],
  maximizeTargetId: string,
): LayoutUiState {
  const hidden = toggleableIds.filter((id) => !api.getPanel(id));
  const target = api.getPanel(maximizeTargetId);
  return { hidden, maximized: target ? safeIsMaximized(target) : false };
}

export interface ToolbarState {
  sidebarVisible: boolean;
  editorVisible: boolean;
  terminalVisible: boolean;
  maximized: boolean;
}

/** A1：工具列視覺態一律由 dockview getPanel 直接推導（不依賴獨立 boolean，避免狀態機去同步）。 */
export function deriveToolbarState(
  api: DockApiLike,
  ids: { sidebar: string; editor: string; terminal: string },
): ToolbarState {
  const term = api.getPanel(ids.terminal);
  return {
    sidebarVisible: api.getPanel(ids.sidebar) != null,
    editorVisible: api.getPanel(ids.editor) != null,
    terminalVisible: term != null,
    maximized: term ? safeIsMaximized(term) : false,
  };
}

/**
 * A5：去抖持久化控制器。
 *  - restoring guard：還原期間（fromJSON/buildDefaultLayout 的事件風暴）忽略 schedule，避免初始多餘寫入與覆寫競態。
 *  - flush：視窗/元件卸載前立即送出最新 envelope，避免去抖視窗內關閉導致丟失最新版面。
 *  - 大小閘門：超過上限的 envelope 直接拒存（A4）。
 */
export class LayoutPersistController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: PersistedLayout | null = null;
  private restoring = false;

  constructor(
    private readonly save: (env: PersistedLayout) => void,
    private readonly delay = 400,
  ) {}

  beginRestore(): void {
    this.restoring = true;
  }

  endRestore(): void {
    this.restoring = false;
  }

  isRestoring(): boolean {
    return this.restoring;
  }

  /** 排程一次去抖存檔。還原期間或超大 envelope 直接忽略（保留上一次良好值）。 */
  schedule(env: PersistedLayout): void {
    if (this.restoring) return;
    if (!withinSizeLimit(env)) return;
    this.pending = env;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  /** 立即送出待存的最新 envelope（卸載/關閉前呼叫）。無待存則 no-op。 */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      const env = this.pending;
      this.pending = null;
      this.save(env);
    }
  }

  /** 清理計時器與待存（不送出）。 */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
