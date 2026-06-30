// 工作區模型基礎（REQ-WS-001/002/005/006/009、REQ-PERF-001）。
// - CRUD：新增（路徑去重 + 有效性檢查）/ 改名 / 移除 / 拖曳排序持久化
// - lazy 實體化：被 activate 才標 hydrated（hydrated 為執行期狀態、不持久化）
// - missing 偵測：資料夾不存在 → status='missing' 保留在列表（不自動移除）
// - teardown 協調：移除時呼叫 WorkspaceLifecycle，完整收尾終端機/監看（避免殭屍程序）
// 工作區清單持久化於 StateStore（userData，不寫使用者專案資料夾）。

import { existsSync, statSync, rmSync } from 'node:fs';
import { resolve, basename, join, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StateStore } from '../store/StateStore';
import type { Workspace, WorkspaceInput, ShellKind } from '../../shared/types';
import type { WorkspaceLifecycle } from './workspaceLifecycle';

const DEFAULT_SHELL: ShellKind = 'powershell';

type StoredWorkspace = Omit<Workspace, 'hydrated'>;

/** 安全判斷是否為存在的資料夾（壞路徑/權限例外一律回 false）。 */
function isExistingDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export class WorkspaceManager {
  /** 執行期 hydrated 狀態（不持久化，REQ-PERF-001 lazy 實體化）。 */
  private readonly hydrated = new Set<string>();

  constructor(
    private readonly store: StateStore,
    private readonly lifecycle: WorkspaceLifecycle,
    /** userData 根目錄（用於 purge profile）。 */
    private readonly userDataDir: string,
  ) {}

  /** 去重正規化鍵：resolve 絕對路徑 + 去尾斜線 + Windows 大小寫不敏感。 */
  private normKey(p: string): string {
    const abs = resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  }

  private read(): StoredWorkspace[] {
    return this.store.get('workspaces');
  }

  private write(list: StoredWorkspace[]): void {
    this.store.set('workspaces', list);
  }

  /** 是否為磁碟根目錄（如 C:\ 或 /）——供 UI 警告（REQ-WS-002）。 */
  static isRootPath(p: string): boolean {
    const abs = resolve(p).replace(/[\\/]+$/, '');
    const { root } = parse(abs);
    return abs === '' || abs === root.replace(/[\\/]+$/, '') || abs + '\\' === root || abs + '/' === root;
  }

  /** 列出所有工作區（即時刷新 missing 狀態 + 附執行期 hydrated；依 order 排序）。 */
  list(): Workspace[] {
    return this.read()
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((w) => ({
        ...w,
        status: isExistingDir(w.path) ? 'ok' : 'missing',
        hydrated: this.hydrated.has(w.id),
      }));
  }

  get(wsId: string): Workspace | undefined {
    return this.list().find((w) => w.id === wsId);
  }

  /** 新增工作區（去重 + 有效性）。回傳 Workspace 或 error。 */
  add(input: WorkspaceInput): Workspace | { error: 'duplicate' | 'invalid' } {
    const raw = input?.path;
    if (typeof raw !== 'string' || raw.trim() === '') return { error: 'invalid' };
    if (!isExistingDir(raw)) return { error: 'invalid' };
    const key = this.normKey(raw);
    const list = this.read();
    if (list.some((w) => this.normKey(w.path) === key)) return { error: 'duplicate' };

    const id = `ws_${randomUUID()}`;
    const abs = resolve(raw).replace(/[\\/]+$/, '');
    const order = list.length ? Math.max(...list.map((w) => w.order)) + 1 : 0;
    const ws: StoredWorkspace = {
      id,
      name: input.name?.trim() || basename(abs) || abs,
      path: abs,
      order,
      status: 'ok',
      defaultShell: DEFAULT_SHELL,
      trusted: true,
      profileDir: join('pw-profiles', id),
    };
    this.write([...list, ws]);
    return { ...ws, hydrated: false };
  }

  /** 改名（REQ-WS-003）。空名忽略。 */
  rename(wsId: string, name: string): void {
    const trimmed = name?.trim();
    if (!trimmed) return;
    this.write(this.read().map((w) => (w.id === wsId ? { ...w, name: trimmed } : w)));
  }

  /** 設某工作區預設 shell（REQ-TERM-003，每工作區記預設）。 */
  setDefaultShell(wsId: string, shell: ShellKind): void {
    this.write(this.read().map((w) => (w.id === wsId ? { ...w, defaultShell: shell } : w)));
  }

  /** 拖曳排序持久化（REQ-WS-010）。未列入的工作區順序保持在後。 */
  reorder(orderedIds: string[]): void {
    const list = this.read();
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    const next = list
      .slice()
      .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
      .map((w, i) => ({ ...w, order: i }));
    this.write(next);
  }

  /** lazy 實體化（REQ-PERF-001）：被 activate 才標 hydrated。missing 不可 activate。 */
  activate(wsId: string): boolean {
    const ws = this.read().find((w) => w.id === wsId);
    if (!ws || !isExistingDir(ws.path)) return false;
    this.hydrated.add(wsId);
    return true;
  }

  isHydrated(wsId: string): boolean {
    return this.hydrated.has(wsId);
  }

  /**
   * 移除工作區（REQ-WS-009）：不論是否 purge 都先完整 teardown 執行中程序/監看；
   * purgeProfile=true 才連同該工作區 Playwright profile 目錄刪除（預設保留）。
   */
  async remove(wsId: string, purgeProfile: boolean): Promise<void> {
    const ws = this.read().find((w) => w.id === wsId);
    // 一律先 teardown（即使工作區不存在也安全 no-op）
    await this.lifecycle.teardown(wsId);
    this.hydrated.delete(wsId);
    if (!ws) return;
    this.write(this.read().filter((w) => w.id !== wsId));
    if (purgeProfile) this.purgeProfileDir(ws.profileDir);
  }

  private purgeProfileDir(profileDir: string): void {
    try {
      const abs = join(this.userDataDir, profileDir);
      if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[Polydesk] purge profile failed:', e);
    }
  }
}
