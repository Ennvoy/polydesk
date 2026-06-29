// F-10 紅軍 fail-safe 單元測試（A1~A5）。純函式 + 注入式「fake-但-真演算法」dockview api：
// FakeApi 以真實 Map 語意 + 真實 duplicate-id 偵測 + 真實 maximize 狀態實作，被測邏輯（toggle/serialize/
// validate/maximize/去抖）全程真跑，非 mock 掉被測邏輯。node 環境可測（無 React/DOM/dockview runtime）。

import { describe, it, expect, vi } from 'vitest';
import type { SerializedDockview } from 'dockview';
import {
  LAYOUT_LIMITS,
  DEFAULT_UI,
  validateLayout,
  serialize,
  deserialize,
  serializedSize,
  withinSizeLimit,
  togglePanel,
  ensurePanel,
  toggleTerminalMaximize,
  deriveToolbarState,
  deriveUiState,
  panelVisibleById,
  LayoutPersistController,
  type PanelLike,
  type PersistedLayout,
} from './layoutPersist';

// ── fake-但-真演算法 dockview api ──
class FakePanel implements PanelLike {
  visible = true; // group 可見性（每 panel 一 group 簡化模型；setVisible 切換、不移除 panel）
  readonly api: PanelLike['api'] & { setSize: (o: { width?: number; height?: number }) => void };
  constructor(
    public readonly id: string,
    public readonly component: string,
    host: FakeApi,
  ) {
    const self = this;
    this.api = {
      isMaximized: () => host.maximizedId === id,
      maximize: () => {
        host.maximizedId = id;
      },
      exitMaximized: () => {
        if (host.maximizedId === id) host.maximizedId = null;
      },
      setSize: () => {
        /* no-op；尺寸不影響本測 */
      },
      group: {
        api: {
          setVisible: (v: boolean) => {
            self.visible = v;
          },
          get isVisible() {
            return self.visible;
          },
        },
      },
    };
  }
}

class FakeApi {
  private readonly panelsMap = new Map<string, FakePanel>();
  maximizedId: string | null = null;
  readonly removed: string[] = [];

  constructor(initial: { id: string; component: string }[] = []) {
    for (const o of initial) this.addPanel(o);
  }

  getPanel(id: string): FakePanel | undefined {
    return this.panelsMap.get(id);
  }

  get panels(): FakePanel[] {
    return Array.from(this.panelsMap.values());
  }

  // 真實 dockview 行為：重複 id 直接 throw。
  addPanel(opts: { id: string; component: string }): FakePanel {
    if (this.panelsMap.has(opts.id)) throw new Error(`duplicate panel id ${opts.id}`);
    const p = new FakePanel(opts.id, opts.component, this);
    this.panelsMap.set(opts.id, p);
    return p;
  }

  removePanel(panel: PanelLike): void {
    this.removed.push(panel.id);
    this.panelsMap.delete(panel.id);
    if (this.maximizedId === panel.id) this.maximizedId = null;
  }

  // 產生通得過 validateLayout 的真實 SerializedDockview 結構。
  toJSON(): SerializedDockview {
    const ids = Array.from(this.panelsMap.keys());
    const tree = {
      grid: {
        root: {
          type: 'branch',
          size: 1000,
          data: ids.map((id) => ({
            type: 'leaf',
            size: 200,
            data: { id: `g_${id}`, views: [id], activeView: id },
          })),
        },
        width: 1200,
        height: 800,
        orientation: 'HORIZONTAL',
      },
      panels: Object.fromEntries(ids.map((id) => [id, { id, contentComponent: this.panelsMap.get(id)!.component }])),
    };
    return tree as unknown as SerializedDockview;
  }
}

const panelsOf = (layout: SerializedDockview | null): string[] =>
  Object.keys((layout as unknown as { panels: Record<string, unknown> }).panels);

// ── A2：合併結構持久化 round-trip ──
describe('A2 — 合併結構持久化（layout + ui）', () => {
  it('serialize→stringify→parse→deserialize 還原同一 ui，且 envelope 同時含 layout 與 ui', () => {
    const api = new FakeApi([
      { id: 'editor', component: 'editor' },
      { id: 'sidebar', component: 'sidebar' },
    ]);
    const env = serialize(api.toJSON(), { hidden: ['terminal'], maximized: true });
    expect(env).toHaveProperty('layout');
    expect(env).toHaveProperty('ui');
    const round = JSON.parse(JSON.stringify(env));
    const { layout, ui } = deserialize(round);
    expect(ui).toEqual({ hidden: ['terminal'], maximized: true });
    expect(layout).not.toBeNull();
  });

  it('envelope 不是只有 dockview toJSON（含 kind/version/ui，頂層無 grid）', () => {
    const api = new FakeApi([{ id: 'editor', component: 'editor' }]);
    const env = serialize(api.toJSON(), DEFAULT_UI);
    expect(env.kind).toBe('polydesk-layout');
    expect(env.version).toBe(1);
    expect(env).toHaveProperty('ui.maximized');
    expect((env as unknown as Record<string, unknown>).grid).toBeUndefined();
  });

  it('legacy 純 dockview 樹可 deserialize（ui 退預設）', () => {
    const api = new FakeApi([{ id: 'editor', component: 'editor' }]);
    const { layout, ui } = deserialize(api.toJSON());
    expect(layout).not.toBeNull();
    expect(ui).toEqual(DEFAULT_UI);
  });

  it('normalizeUi：髒 ui 欄位被收斂為安全值', () => {
    const round = JSON.parse(
      JSON.stringify({ kind: 'polydesk-layout', version: 1, layout: new FakeApi([{ id: 'editor', component: 'editor' }]).toJSON(), ui: { hidden: ['ok', 1, null], maximized: 'yes' } }),
    );
    expect(deserialize(round).ui).toEqual({ hidden: ['ok'], maximized: false });
  });
});

// ── A4：不受信任 layout 驗證 + 大小閘門 ──
describe('A4 — 不受信任 layout 驗證閘門', () => {
  const leaf = (id: string, size: number): unknown => ({
    type: 'leaf',
    size,
    data: { id: `g_${id}`, views: [id], activeView: id },
  });
  const layoutWith = (nodes: unknown[], panelIds: string[]): unknown => ({
    grid: { root: { type: 'branch', size: 1000, data: nodes }, width: 1200, height: 800, orientation: 'HORIZONTAL' },
    panels: Object.fromEntries(panelIds.map((id) => [id, { id }])),
  });

  it('panels>0 但含 NaN 尺寸 → invalid', () => {
    expect(validateLayout(layoutWith([leaf('a', NaN)], ['a']))).toBe(false);
  });

  it('含負尺寸 → invalid', () => {
    expect(validateLayout(layoutWith([leaf('a', -10)], ['a']))).toBe(false);
  });

  it('grid 尺寸 NaN/負值 → invalid', () => {
    expect(validateLayout({ grid: { root: leaf('a', 100), width: NaN, height: 800, orientation: 'H' }, panels: { a: { id: 'a' } } })).toBe(false);
  });

  it('panel 數超上限 → invalid', () => {
    const ids = Array.from({ length: LAYOUT_LIMITS.maxPanels + 1 }, (_, i) => `p${i}`);
    expect(validateLayout(layoutWith(ids.map((id) => leaf(id, 100)), ids))).toBe(false);
  });

  it('巢狀深度超上限 → invalid', () => {
    let node: unknown = leaf('a', 100);
    for (let d = 0; d < LAYOUT_LIMITS.maxDepth + 1; d++) node = { type: 'branch', size: 100, data: [node] };
    expect(validateLayout({ grid: { root: node, width: 1200, height: 800, orientation: 'H' }, panels: { a: { id: 'a' } } })).toBe(false);
  });

  it('健全 layout → valid', () => {
    expect(validateLayout(layoutWith([leaf('a', 100), leaf('b', 100)], ['a', 'b']))).toBe(true);
  });

  it('非物件 / 缺 grid / 空 panels → invalid', () => {
    expect(validateLayout(null)).toBe(false);
    expect(validateLayout('x')).toBe(false);
    expect(validateLayout({})).toBe(false);
    expect(validateLayout(layoutWith([], []))).toBe(false);
  });

  it('序列化字串 >256KB → 拒存（withinSizeLimit=false）', () => {
    const big = {
      kind: 'polydesk-layout',
      version: 1,
      layout: { blob: 'x'.repeat(LAYOUT_LIMITS.maxBytes + 2000) },
      ui: DEFAULT_UI,
    };
    expect(serializedSize(big)).toBeGreaterThan(LAYOUT_LIMITS.maxBytes);
    expect(withinSizeLimit(big)).toBe(false);
  });

  it('正常大小 envelope → 可存', () => {
    const api = new FakeApi([{ id: 'editor', component: 'editor' }]);
    expect(withinSizeLimit(serialize(api.toJSON(), DEFAULT_UI))).toBe(true);
  });

  it('deserialize 對 invalid layout 回 layout=null（呼叫端據此走 buildDefaultLayout）', () => {
    const bad = JSON.parse(JSON.stringify(serialize(layoutWith([leaf('a', -1)], ['a']) as unknown as SerializedDockview, DEFAULT_UI)));
    expect(deserialize(bad).layout).toBeNull();
  });
});

// ── A1：顯隱以 dockview 為單一真相 ──
describe('A1 — 顯隱單一真相 + 去重防 duplicate id', () => {
  const addSidebar = (api: FakeApi) => (): void => {
    api.addPanel({ id: 'sidebar', component: 'sidebar' });
  };

  it('還原後不含 sidebar：togglePanel 不 throw 且重新加入', () => {
    const api = new FakeApi([
      { id: 'editor', component: 'editor' },
      { id: 'terminal', component: 'terminal' },
    ]);
    expect(api.getPanel('sidebar')).toBeUndefined();
    let visible = false;
    expect(() => {
      visible = togglePanel(api, 'sidebar', addSidebar(api));
    }).not.toThrow();
    expect(visible).toBe(true);
    expect(api.getPanel('sidebar')).toBeDefined();
  });

  it('連續 togglePanel（隱藏↔顯示）以 setVisible 切換、不移除 panel（不 dispose component）', () => {
    const api = new FakeApi([
      { id: 'editor', component: 'editor' },
      { id: 'sidebar', component: 'sidebar' },
    ]);
    expect(togglePanel(api, 'sidebar', addSidebar(api))).toBe(false); // 隱藏
    expect(api.getPanel('sidebar')).toBeDefined(); // 未移除（panel 還在）
    expect(api.removed).not.toContain('sidebar'); // 關鍵：未 dispose（終端機 PTY/編輯器開檔不會消失）
    expect(togglePanel(api, 'sidebar', addSidebar(api))).toBe(true); // 顯示
    expect(api.getPanel('sidebar')).toBeDefined();
  });

  it('ensurePanel 重複呼叫不 throw 且只存在一份（去重）', () => {
    const api = new FakeApi([{ id: 'editor', component: 'editor' }]);
    expect(() => {
      ensurePanel(api, 'sidebar', addSidebar(api));
      ensurePanel(api, 'sidebar', addSidebar(api));
    }).not.toThrow();
    expect(api.panels.filter((p) => p.id === 'sidebar').length).toBe(1);
  });

  it('工具列 is-active＝panel 存在且 group 可見；顯隱用 setVisible 不移除 panel（不 dispose）', () => {
    const api = new FakeApi([
      { id: 'editor', component: 'editor' },
      { id: 'sidebar', component: 'sidebar' },
      { id: 'terminal', component: 'terminal' },
    ]);
    const ids = { sidebar: 'sidebar', editor: 'editor', terminal: 'terminal' };
    let st = deriveToolbarState(api, ids);
    expect(st.sidebarVisible).toBe(true);
    expect(st.terminalVisible).toBe(true);

    // 隱藏 sidebar（setVisible(false)）→ 視覺態 false，但「不移除 panel」(component 不 dispose)。
    expect(togglePanel(api, 'sidebar', addSidebar(api))).toBe(false);
    st = deriveToolbarState(api, ids);
    expect(st.sidebarVisible).toBe(false);
    expect(st.sidebarVisible).toBe(panelVisibleById(api, 'sidebar'));
    // 關鍵 bug 修復：隱藏不 dispose（終端機 PTY / 編輯器開檔保留）。
    expect(api.getPanel('sidebar')).toBeDefined();
    expect(api.removed).not.toContain('sidebar');

    // 再 toggle 回來 → 顯示。
    expect(togglePanel(api, 'sidebar', addSidebar(api))).toBe(true);
    expect(deriveToolbarState(api, ids).sidebarVisible).toBe(true);
  });
});

// ── A3：最大化用原生可逆 API，永不 removePanel(editor) ──
describe('A3 — 終端機最大化可逆、editor 不消失', () => {
  it('toggleTerminalMaximize 全程不 removePanel(editor)，序列化還原後 editor 仍在', () => {
    const api = new FakeApi([
      { id: 'editor', component: 'editor' },
      { id: 'terminal', component: 'terminal' },
    ]);
    expect(toggleTerminalMaximize(api, 'terminal')).toBe(true);
    expect(api.getPanel('terminal')!.api.isMaximized()).toBe(true);
    expect(api.removed).not.toContain('editor');

    const round = JSON.parse(
      JSON.stringify(serialize(api.toJSON(), deriveUiState(api, ['sidebar', 'terminal'], 'terminal'))),
    );
    const { layout } = deserialize(round);
    expect(layout).not.toBeNull();
    expect(panelsOf(layout)).toContain('editor');
    // dockview toJSON 不保證序列化最大化態 → 由 ui 補存。
    expect(round.ui.maximized).toBe(true);
  });

  it('再次呼叫 → exitMaximized（可逆），editor 從未被移除', () => {
    const api = new FakeApi([
      { id: 'editor', component: 'editor' },
      { id: 'terminal', component: 'terminal' },
    ]);
    toggleTerminalMaximize(api, 'terminal');
    expect(toggleTerminalMaximize(api, 'terminal')).toBe(false);
    expect(api.getPanel('terminal')!.api.isMaximized()).toBe(false);
    expect(api.removed).not.toContain('editor');
    expect(api.getPanel('editor')).toBeDefined();
  });

  it('終端機不存在 → no-op false', () => {
    const api = new FakeApi([{ id: 'editor', component: 'editor' }]);
    expect(toggleTerminalMaximize(api, 'terminal')).toBe(false);
  });
});

// ── A5：去抖 flush + 還原競態 guard ──
describe('A5 — 去抖 flush + restoring guard', () => {
  const envOf = (ui: { hidden: string[]; maximized: boolean }): PersistedLayout =>
    serialize(new FakeApi([{ id: 'editor', component: 'editor' }]).toJSON(), ui);

  it('flush 以最新 layout 送出一次（去抖視窗內關閉不丟最新）', () => {
    const saved: PersistedLayout[] = [];
    const c = new LayoutPersistController((e) => saved.push(e), 400);
    c.schedule(envOf({ hidden: [], maximized: false }));
    c.schedule(envOf({ hidden: ['terminal'], maximized: true }));
    c.flush(); // 模擬卸載/關閉
    expect(saved.length).toBe(1);
    expect(saved[0].ui).toEqual({ hidden: ['terminal'], maximized: true });
  });

  it('去抖計時器到點自動送出（fake timers）', () => {
    vi.useFakeTimers();
    try {
      const saved: PersistedLayout[] = [];
      const c = new LayoutPersistController((e) => saved.push(e), 400);
      c.schedule(envOf(DEFAULT_UI));
      expect(saved.length).toBe(0);
      vi.advanceTimersByTime(400);
      expect(saved.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('還原期間（restoring）注入的 schedule 不觸發 save；endRestore 後恢復', () => {
    const saved: PersistedLayout[] = [];
    const c = new LayoutPersistController((e) => saved.push(e), 400);
    c.beginRestore();
    c.schedule(envOf(DEFAULT_UI));
    c.flush();
    expect(saved.length).toBe(0);
    c.endRestore();
    c.schedule(envOf(DEFAULT_UI));
    c.flush();
    expect(saved.length).toBe(1);
  });

  it('超大 envelope 直接拒存（A4 大小閘門）', () => {
    const saved: PersistedLayout[] = [];
    const c = new LayoutPersistController((e) => saved.push(e), 400);
    const huge = {
      kind: 'polydesk-layout',
      version: 1,
      layout: { blob: 'x'.repeat(LAYOUT_LIMITS.maxBytes + 5000) },
      ui: DEFAULT_UI,
    } as unknown as PersistedLayout;
    c.schedule(huge);
    c.flush();
    expect(saved.length).toBe(0);
  });

  it('dispose 後不再送出待存', () => {
    const saved: PersistedLayout[] = [];
    const c = new LayoutPersistController((e) => saved.push(e), 400);
    c.schedule(envOf(DEFAULT_UI));
    c.dispose();
    c.flush();
    expect(saved.length).toBe(0);
  });
});
