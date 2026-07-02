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

/** addWorktree 輸入：worktree 資料夾路徑 + 所屬主工作樹路徑；trusted 省略時須主工作樹已納管。 */
export type WorktreeInput = { path: string; mainPath: string; name?: string; trusted?: boolean };
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

  /**
   * REQ-WT-003：納管一個 worktree 資料夾為工作區。信任繼承規則（紅軍 A2）：
   *  - 主工作樹已納管 → 繼承其 trusted、記 worktree.mainPath。
   *  - 主工作樹未納管：僅在呼叫端已完成 lineage 交叉驗證後、明確傳 trusted:true 才納管；
   *    否則回 main-not-managed（呼叫端應走 REQ-WS-008 正常信任彈窗）。
   * mainPath 一律正規化持久化；分支名不存（顯示時即時查）。
   */
  addWorktree(input: WorktreeInput): Workspace | { error: 'duplicate' | 'invalid' | 'main-not-managed' } {
    const raw = input?.path;
    if (typeof raw !== 'string' || raw.trim() === '') return { error: 'invalid' };
    if (!isExistingDir(raw)) return { error: 'invalid' };
    if (typeof input.mainPath !== 'string' || input.mainPath.trim() === '') return { error: 'invalid' };
    const key = this.normKey(raw);
    const list = this.read();
    if (list.some((w) => this.normKey(w.path) === key)) return { error: 'duplicate' };

    const mainAbs = resolve(input.mainPath).replace(/[\\/]+$/, '');
    const mainKey = this.normKey(mainAbs);
    const main = list.find((w) => this.normKey(w.path) === mainKey);
    let trusted: boolean;
    if (main) trusted = main.trusted;
    else if (input.trusted === true) trusted = true;
    else return { error: 'main-not-managed' };

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
      trusted,
      profileDir: join('pw-profiles', id),
      worktree: { mainPath: mainAbs },
    };
    this.write([...list, ws]);
    return { ...ws, hydrated: false };
  }

  /**
   * REQ-WT-012＋紅軍 A5：某工作區的 git 序列佇列鍵。worktree 工作區解回其主工作樹的 wsId
   * （若主工作樹已納管），使「同一 repo 的所有 worktree」共用單一序列佇列鍵，避免 index.lock 交錯。
   */
  queueKeyForRepo(wsId: string): string {
    const ws = this.get(wsId);
    if (!ws?.worktree) return wsId;
    const mainKey = this.normKey(ws.worktree.mainPath);
    const main = this.list().find((w) => this.normKey(w.path) === mainKey);
    return main?.id ?? wsId;
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

  /**
   * REQ-WT-006＋紅軍：只 teardown 不 delist（釋放檔案 handle，Windows 下 git worktree remove 才不 EBUSY），
   * 供「連同刪除」流程先 teardown→git remove 成功後才 delist（失敗則工作區項保留、不半殘）。
   */
  async teardownOnly(wsId: string): Promise<void> {
    await this.lifecycle.teardown(wsId);
    this.hydrated.delete(wsId);
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
