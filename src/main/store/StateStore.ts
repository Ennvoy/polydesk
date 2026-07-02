// userData 持久化（REQ-PERSIST-001/003/004/005）。
// - 原子寫（temp + fsync + rename），當機半寫不壞檔
// - 讀檔 parse 失敗 / 損毀 → 備份壞檔（.corrupt-<ts>.json）+ 以預設啟動（不 brick）
// - 未知舊版本走遷移；未來版本視為損毀
// - get / set / getAll、export(寫出字串) / import(讀入字串)
// 檔案路徑可注入以便測試（不碰真 userData）。

import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { AiCommitSettings, LayoutJson, PersistState, TerminalFontSettings, ThemeId, WindowBounds } from '../../shared/types';
import { CURRENT_SCHEMA_VERSION, defaultState, migrate } from './schema';

export class StateStore {
  private cache: PersistState;

  constructor(private readonly filePath: string) {
    this.cache = defaultState();
  }

  /** 讀入狀態（不存在則建預設；損毀則備份後回預設）。回傳目前 state。 */
  load(): PersistState {
    if (!existsSync(this.filePath)) {
      this.cache = defaultState();
      this.persist();
      return this.getAll();
    }
    try {
      const text = readFileSync(this.filePath, 'utf-8');
      const raw: unknown = JSON.parse(text);
      this.cache = migrate(raw);
      const rawVersion = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
      if (rawVersion !== CURRENT_SCHEMA_VERSION) this.persist(); // 寫回升級/正規化後的形態
    } catch {
      this.backupCorrupt();
      this.cache = defaultState();
      this.persist();
    }
    return this.getAll();
  }

  private backupCorrupt(): void {
    try {
      const base = this.filePath.replace(/\.json$/i, '');
      renameSync(this.filePath, `${base}.corrupt-${Date.now()}.json`);
    } catch {
      /* 備份失敗不致命：仍以預設啟動 */
    }
  }

  /** 原子寫：temp + fsync + rename。 */
  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const data = JSON.stringify(this.cache, null, 2);
    const fd = openSync(tmp, 'w');
    try {
      writeFileSync(fd, data, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }

  getAll(): PersistState {
    return structuredClone(this.cache);
  }

  get<K extends keyof PersistState>(key: K): PersistState[K] {
    return structuredClone(this.cache[key]);
  }

  set<K extends keyof PersistState>(key: K, value: PersistState[K]): void {
    this.cache = { ...this.cache, [key]: value };
    this.persist();
  }

  setTheme(theme: ThemeId): void {
    this.set('theme', theme);
  }

  setLayout(layout: LayoutJson): void {
    this.set('layout', layout);
  }

  setWindowBounds(bounds: WindowBounds): void {
    this.set('windowBounds', bounds);
  }

  setRailWidth(width: number): void {
    this.set('railWidth', width);
  }

  setAiCommit(cfg: AiCommitSettings): void {
    this.set('aiCommit', cfg);
  }

  /** undefined＝清除自訂、回落預設（Consolas 14）。 */
  setTerminalFont(cfg: TerminalFontSettings | undefined): void {
    this.set('terminalFont', cfg);
  }

  /** 匯出目前狀態字串（REQ-PERSIST-005）。 */
  exportJson(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /** 匯入狀態字串（驗證 + 遷移後覆蓋並落檔），失敗回明確錯誤、不破壞現狀。 */
  importJson(json: string): { ok: true } | { error: string } {
    try {
      const parsed: unknown = JSON.parse(json);
      this.cache = migrate(parsed);
      this.persist();
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}
