// fs:read / fs:write 真實實作（F-4，取代 fs stub 的 read/write）。
// 安全錨點：一律以 WorkspaceManager.get(wsId).path 的 realpath 為根解析；
//   realpath 後用 path.relative 做邊界檢查（解 symlink/junction/8.3 短名/大小寫），
//   拒 UNC / \\?\ 長路徑前綴；絕對 path 必須仍落在 workspace 內才放行（REQ-SEC-003 / 紅軍 F-4-A1）。
// 編碼：BOM 為硬證據優先 → 合法 UTF-8 視為 utf-8 → 否則 jschardet + zh-TW Big5 結構權重；
//   未知/低信心不靜默以錯編碼 re-encode（預設 utf-8 + lowConfidence，紅軍 F-4-A2）。
// EOL/BOM：content 一律剝 BOM、寫檔逐位元組忠實（不全域正規化換行），保留原換行（紅軍 F-4-A3）。
// 寫檔：原子（temp + fsync + rename）+ 以「上次交給 renderer 的 mtime」做 lost-update 衝突偵測（紅軍 F-4-A4）。
// 讀檔：stat 先擋目錄/特殊檔與超大檔，避免 OOM / EISDIR / 卡死（紅軍 F-4-A5）。

import { realpathSync, constants as fsConstants, promises as fsp } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join, basename } from 'node:path';
import jschardet from 'jschardet';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { shell } from 'electron';
import type { IpcMain } from 'electron';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { FileEncoding, Eol } from '../../shared/types';
import type { InvokeReq } from '../../shared/ipc';

/** 讀取硬上限（防 OOM）；REQ-PERF-003 一般檔 ≤1MB，此為避免單檔 DoS 的安全閘。 */
export const DEFAULT_MAX_READ_BYTES = 50 * 1024 * 1024;
/** jschardet 信心低於此值視為 lowConfidence（不靜默以該編碼重寫）。 */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export type FsErrorCode = 'outside-workspace' | 'too-large' | 'not-a-file' | 'not-found' | 'read-failed';

/** 型別化檔案服務錯誤（fs:read 契約無 error 變體 → 以 throw 讓 IPC reject，狀態清楚）。 */
export class FileServiceError extends Error {
  constructor(public readonly code: FsErrorCode) {
    super(code);
    this.name = 'FileServiceError';
  }
}

/** 記錄「上次交給 renderer 的版本 mtime」供 lost-update 衝突偵測（key = realpath 絕對路徑）。 */
const readVersions = new Map<string, number>();
let writeSeq = 0;

// ── 路徑沙箱 ──────────────────────────────────────────────────────────────

/** UNC（\\server）或裝置/長路徑前綴（\\?\、\\.\）；正反斜線皆擋。 */
const UNC_OR_DEVICE = /^[\\/]{2}/;

/** 解析「存在部分」的 realpath（沿 symlink/junction/短名/大小寫正規化），再接上尚不存在的尾段。 */
function realpathExisting(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(cur);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p); // 連根都不存在：回正規化結果
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

/** realTarget 是否落在 realRoot 之內（含等於根）；用 path.relative 邊界檢查、避免前綴混淆。 */
function isInside(realRoot: string, realTarget: string): boolean {
  const rel = relative(realRoot, realTarget);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 把 (wsId, path) 解析成 workspace 沙箱內的安全絕對路徑；越界/UNC 一律拒。 */
export function resolveSafe(
  mgr: WorkspaceManager,
  wsId: string,
  p: string,
): { ok: true; abs: string } | { error: 'outside-workspace' } {
  if (typeof p !== 'string' || p === '') return { error: 'outside-workspace' };
  if (UNC_OR_DEVICE.test(p)) return { error: 'outside-workspace' };
  const ws = mgr.get(wsId);
  if (!ws) return { error: 'outside-workspace' };
  let realRoot: string;
  try {
    realRoot = realpathSync.native(ws.path);
  } catch {
    return { error: 'outside-workspace' }; // workspace 路徑無法解析（missing 等）→ 拒
  }
  const candidate = resolve(realRoot, p); // p 為絕對則直接是 p → 仍須通過下方邊界檢查
  if (UNC_OR_DEVICE.test(candidate)) return { error: 'outside-workspace' };
  const realTarget = realpathExisting(candidate);
  if (UNC_OR_DEVICE.test(realTarget)) return { error: 'outside-workspace' };
  if (!isInside(realRoot, realTarget)) return { error: 'outside-workspace' };
  return { ok: true, abs: realTarget };
}

/** 同 resolveSafe，但「不 realpath 最後一段」：symlink 葉節點保留自身路徑（不跟隨到 target）。
 *  供刪除這類須操作 entry 本身、不可跟隨 symlink 到目標的操作（否則會誤刪/誤清 target 內容，codex P1-1）。 */
export function resolveSafeNoFollowLeaf(
  mgr: WorkspaceManager,
  wsId: string,
  p: string,
): { ok: true; abs: string } | { error: 'outside-workspace' } {
  if (typeof p !== 'string' || p === '') return { error: 'outside-workspace' };
  if (UNC_OR_DEVICE.test(p)) return { error: 'outside-workspace' };
  const ws = mgr.get(wsId);
  if (!ws) return { error: 'outside-workspace' };
  let realRoot: string;
  try {
    realRoot = realpathSync.native(ws.path);
  } catch {
    return { error: 'outside-workspace' };
  }
  const candidate = resolve(realRoot, p);
  if (UNC_OR_DEVICE.test(candidate)) return { error: 'outside-workspace' };
  // 只解析父層 realpath（沿 symlink/短名正規化），葉節點用原 basename 接上——不跟隨葉自身。
  const abs = join(realpathExisting(dirname(candidate)), basename(candidate));
  if (UNC_OR_DEVICE.test(abs)) return { error: 'outside-workspace' };
  if (!isInside(realRoot, abs)) return { error: 'outside-workspace' };
  return { ok: true, abs };
}

// ── 編碼偵測 ──────────────────────────────────────────────────────────────

function detectByBom(buf: Buffer): FileEncoding | null {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8-bom';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  return null;
}

/** jschardet 名稱 → FileEncoding 白名單對映；未知回 null（不臆測）。 */
function normalizeEncoding(name: string | null): FileEncoding | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  switch (n) {
    case 'big5':
    case 'cp950':
    case 'big5hkscs':
      return 'big5';
    case 'utf8':
    case 'ascii':
    case 'usascii':
      return 'utf-8';
    case 'utf16le':
    case 'utf16':
      return 'utf-16le';
    case 'utf16be':
      return 'utf-16be';
    default:
      return null;
  }
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** 緩衝是否為結構合法的 Big5（且至少含一個雙位元組序列；純 ASCII 不算）。 */
function isValidBig5(buf: Buffer): boolean {
  let i = 0;
  let sawDouble = false;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    if (b < 0x81 || b > 0xfe) return false; // 非合法 lead
    const t = buf[i + 1];
    if (t === undefined) return false; // 尾段落單
    const trailOk = (t >= 0x40 && t <= 0x7e) || (t >= 0xa1 && t <= 0xfe);
    if (!trailOk) return false;
    sawDouble = true;
    i += 2;
  }
  return sawDouble;
}

export interface EncodingDetection {
  encoding: FileEncoding;
  confidence: number;
  /** 偵測信心不足或編碼未對映：不應靜默以該編碼 re-encode，交 UI 提示使用者手動指定。 */
  lowConfidence: boolean;
}

/** 偵測緩衝編碼（BOM 硬證據優先 → 合法 UTF-8 → jschardet + zh-TW Big5 結構權重）。 */
export function detectEncoding(buf: Buffer): EncodingDetection {
  const bom = detectByBom(buf);
  if (bom) return { encoding: bom, confidence: 1, lowConfidence: false };
  if (buf.length === 0) return { encoding: 'utf-8', confidence: 1, lowConfidence: false };
  if (isValidUtf8(buf)) return { encoding: 'utf-8', confidence: 1, lowConfidence: false };

  let jres: { encoding: string | null; confidence: number };
  try {
    jres = jschardet.detect(buf);
  } catch {
    jres = { encoding: null, confidence: 0 };
  }
  const mapped = normalizeEncoding(jres.encoding);
  if (mapped === 'big5') {
    return { encoding: 'big5', confidence: jres.confidence, lowConfidence: jres.confidence < LOW_CONFIDENCE_THRESHOLD };
  }
  // zh-TW 權重：非 UTF-8 但結構合法 Big5 → 判 Big5（壓制 windows-1252 之類誤判）。
  if (isValidBig5(buf)) {
    return { encoding: 'big5', confidence: Math.max(jres.confidence, 0.6), lowConfidence: false };
  }
  if (mapped && mapped !== 'utf-8') {
    return { encoding: mapped, confidence: jres.confidence, lowConfidence: jres.confidence < LOW_CONFIDENCE_THRESHOLD };
  }
  // 未知/未對映（windows-1252、iso-8859-* 等）→ 不臆測：預設 utf-8 + lowConfidence。
  return { encoding: 'utf-8', confidence: jres.confidence, lowConfidence: true };
}

// ── 編解碼（BOM 一律剝離/單次補回，不做全域 EOL 正規化） ──────────────────

function decodeWith(buf: Buffer, encoding: FileEncoding): string {
  switch (encoding) {
    case 'utf-8-bom': {
      const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
      return iconv.decode(body, 'utf8');
    }
    case 'utf-16le': {
      const body = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2) : buf;
      return iconv.decode(body, 'utf16le');
    }
    case 'utf-16be': {
      const body = buf[0] === 0xfe && buf[1] === 0xff ? buf.subarray(2) : buf;
      return iconv.decode(body, 'utf16be');
    }
    case 'big5':
      return iconv.decode(buf, 'big5');
    case 'utf-8':
    default:
      return iconv.decode(buf, 'utf8');
  }
}

function encodeContent(content: string, encoding: FileEncoding): Buffer {
  // content 內任何前導 BOM 一律剝除，避免雙 BOM；BOM 僅由 encoding 在此處單次補回（F-4-A3）。
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), iconv.encode(text, 'utf8')]);
    case 'utf-16le':
      return iconv.encode(text, 'utf16le', { addBOM: true });
    case 'utf-16be':
      return iconv.encode(text, 'utf16be', { addBOM: true });
    case 'big5':
      return iconv.encode(text, 'big5');
    case 'utf-8':
    default:
      return iconv.encode(text, 'utf8');
  }
}

function detectEol(content: string): Eol {
  return content.includes('\r\n') ? 'crlf' : 'lf';
}

async function isReadonly(abs: string): Promise<boolean> {
  try {
    await fsp.access(abs, fsConstants.W_OK);
    return false;
  } catch {
    return true;
  }
}

function isPermError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

/** 原子寫：同目錄 temp + fsync + rename（rename 同檔案系統具原子性，杜絕截斷/空檔，F-4-A4）。 */
async function atomicWrite(abs: string, bytes: Buffer): Promise<void> {
  const tmp = join(dirname(abs), `.polydesk-tmp-${process.pid}-${Date.now()}-${(writeSeq++).toString(36)}`);
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fsp.rename(tmp, abs);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// ── 對外：read / write 核心（可直接單元測試） ─────────────────────────────

export interface ReadResult {
  content: string;
  encoding: FileEncoding;
  eol: Eol;
  readonly: boolean;
}

export interface ReadOptions {
  /** 讀取大小上限（測試可注入低值驗 too-large 路徑）。 */
  maxBytes?: number;
}

/** fs:read 核心；越界/目錄/特殊檔/超大/讀失敗一律 throw（IPC 會 reject）。 */
export async function readFileSafe(
  mgr: WorkspaceManager,
  req: InvokeReq<'fs:read'>,
  opts?: ReadOptions,
): Promise<ReadResult> {
  const safe = resolveSafe(mgr, req.wsId, req.path);
  if ('error' in safe) throw new FileServiceError('outside-workspace');
  const abs = safe.abs;

  let st;
  try {
    st = await fsp.stat(abs); // stat 不跟隨「待讀檔本身」以外的東西；目錄/FIFO 在此被擋
  } catch {
    throw new FileServiceError('not-found');
  }
  if (!st.isFile()) throw new FileServiceError('not-a-file'); // 拒目錄/FIFO/裝置檔（不無限 await）
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  if (st.size > maxBytes) throw new FileServiceError('too-large'); // 讀前擋大檔，永不整檔載入

  let buf: Buffer;
  try {
    buf = await fsp.readFile(abs);
  } catch {
    throw new FileServiceError('read-failed');
  }

  const det = detectEncoding(buf);
  const content = decodeWith(buf, det.encoding);
  const eol = detectEol(content);
  const readonly = await isReadonly(abs);
  readVersions.set(abs, st.mtimeMs); // 記下交付版本，供寫回時偵測外部變更
  return { content, encoding: det.encoding, eol, readonly };
}

/** fs:write 核心；越界 throw、唯讀/權限回 {error:'permission'}、外部已改回 {error:'conflict'}。 */
export async function writeFileSafe(
  mgr: WorkspaceManager,
  req: InvokeReq<'fs:write'>,
): Promise<{ ok: true } | { error: 'permission' | 'conflict' }> {
  const safe = resolveSafe(mgr, req.wsId, req.path);
  if ('error' in safe) throw new FileServiceError('outside-workspace');
  const abs = safe.abs;

  let exists = true;
  let curMtime: number | undefined;
  try {
    const st = await fsp.stat(abs);
    if (!st.isFile()) throw new FileServiceError('not-a-file'); // 不可寫到目錄/特殊檔
    curMtime = st.mtimeMs;
  } catch (e) {
    if (e instanceof FileServiceError) throw e;
    exists = false;
  }

  // 既有檔不可寫 → permission（先擋，確定性且不留 temp）。
  if (exists && (await isReadonly(abs))) return { error: 'permission' };

  // lost-update：曾交付過此檔，磁碟現況 mtime 已被外部改動 → 不靜默覆蓋（REQ-EDIT-007）。
  const known = readVersions.get(abs);
  if (exists && known !== undefined && curMtime !== undefined && curMtime !== known) {
    return { error: 'conflict' };
  }

  const bytes = encodeContent(req.content, req.encoding);
  try {
    await atomicWrite(abs, bytes);
  } catch (e) {
    if (isPermError(e)) return { error: 'permission' };
    throw e;
  }
  try {
    const st2 = await fsp.stat(abs);
    readVersions.set(abs, st2.mtimeMs);
  } catch {
    /* 更新版本指紋失敗不致命 */
  }
  return { ok: true };
}

// ── fs 編輯操作（檔案總管右鍵；path 一律經 resolveSafe 限工作區內） ──────────

/** 路徑是否存在。 */
async function pathExists(abs: string): Promise<boolean> {
  try {
    await fsp.stat(abs);
    return true;
  } catch {
    return false;
  }
}

/** fs 操作錯誤 → 友善中文訊息。 */
function fsOpError(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === 'EEXIST') return '同名項目已存在';
  if (code === 'ENOENT') return '找不到項目';
  if (code === 'EACCES' || code === 'EPERM') return '沒有權限';
  if (code === 'ENOTEMPTY') return '資料夾非空';
  return (e as Error | null)?.message ?? '操作失敗';
}

/** 建立檔案或資料夾（建檔時父目錄自動建立；已存在則拒）。 */
export async function createEntry(
  mgr: WorkspaceManager,
  wsId: string,
  p: string,
  dir: boolean,
): Promise<{ ok: true } | { error: string }> {
  const safe = resolveSafe(mgr, wsId, p);
  if ('error' in safe) return { error: '路徑超出工作區範圍' };
  try {
    if (await pathExists(safe.abs)) return { error: '同名項目已存在' };
    if (dir) {
      await fsp.mkdir(safe.abs, { recursive: false });
    } else {
      await fsp.mkdir(dirname(safe.abs), { recursive: true });
      await fsp.writeFile(safe.abs, '', { flag: 'wx' });
    }
    return { ok: true };
  } catch (e) {
    return { error: fsOpError(e) };
  }
}

/** 改名/移動（from→to，皆限工作區內；目標已存在則拒）。 */
export async function renameEntry(
  mgr: WorkspaceManager,
  wsId: string,
  from: string,
  to: string,
): Promise<{ ok: true } | { error: string }> {
  const sf = resolveSafe(mgr, wsId, from);
  const st = resolveSafe(mgr, wsId, to);
  if ('error' in sf || 'error' in st) return { error: '路徑超出工作區範圍' };
  if (sf.abs === st.abs) return { ok: true };
  try {
    if (await pathExists(st.abs)) return { error: '目標已存在' };
    await fsp.rename(sf.abs, st.abs);
    return { ok: true };
  } catch (e) {
    return { error: fsOpError(e) };
  }
}

/** 刪除檔案/資料夾 → 移到系統資源回收桶（可救回、非永久刪）；不跟隨 symlink 葉、不可刪工作區根。
 *  trash 可注入供測試（預設 Electron shell.trashItem）。 */
export async function deleteEntry(
  mgr: WorkspaceManager,
  wsId: string,
  p: string,
  trash: (abs: string) => Promise<void> = (abs) => shell.trashItem(abs),
): Promise<{ ok: true } | { error: string }> {
  const safe = resolveSafeNoFollowLeaf(mgr, wsId, p); // 不跟隨 symlink 葉：處理 link 本身而非其 target
  if ('error' in safe) return { error: '路徑超出工作區範圍' };
  let realRoot: string | null = null;
  try {
    const ws = mgr.get(wsId);
    realRoot = ws ? realpathSync.native(ws.path) : null;
  } catch {
    realRoot = null;
  }
  if (realRoot && safe.abs === realRoot) return { error: '不可刪除工作區根目錄' };
  try {
    await trash(safe.abs);
    return { ok: true };
  } catch (e) {
    return { error: fsOpError(e) };
  }
}

/** 複製檔案/資料夾（遞迴）；目標已存在則拒。 */
export async function copyEntry(
  mgr: WorkspaceManager,
  wsId: string,
  from: string,
  to: string,
): Promise<{ ok: true } | { error: string }> {
  const sf = resolveSafe(mgr, wsId, from);
  const st = resolveSafe(mgr, wsId, to);
  if ('error' in sf || 'error' in st) return { error: '路徑超出工作區範圍' };
  try {
    if (await pathExists(st.abs)) return { error: '目標已存在' };
    await fsp.cp(sf.abs, st.abs, { recursive: true, errorOnExist: true, force: false });
    return { ok: true };
  } catch (e) {
    return { error: fsOpError(e) };
  }
}

/** destDir 內找出不衝突的檔名（VSCode 風：name.ext → name copy.ext → name copy 2.ext）。 */
async function uniqueName(destAbs: string, base: string): Promise<string> {
  if (!(await pathExists(join(destAbs, base)))) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 1; ; i++) {
    const cand = i === 1 ? `${stem} copy${ext}` : `${stem} copy ${i}${ext}`;
    if (!(await pathExists(join(destAbs, cand)))) return cand;
  }
}

/** 貼入外部檔案（系統剪貼簿）：sources（外部絕對路徑）逐一複製進 destDir（工作區內、重名自動改名）。
 *  destDir 經 resolveSafe 限工作區內；source 為外部路徑（使用者剪貼簿內容，屬匯入來源，不沙箱）。 */
export async function importFiles(
  mgr: WorkspaceManager,
  wsId: string,
  destDir: string,
  sources: string[],
): Promise<{ imported: number; names: string[]; errors?: string[] } | { error: string }> {
  const safe = resolveSafe(mgr, wsId, destDir === '' ? '.' : destDir);
  if ('error' in safe) return { error: '目標路徑超出工作區範圍' };
  try {
    const st = await fsp.stat(safe.abs);
    if (!st.isDirectory()) return { error: '貼上目標不是資料夾' };
  } catch {
    return { error: '貼上目標不存在' };
  }
  const names: string[] = [];
  const errors: string[] = [];
  let imported = 0;
  for (const src of sources) {
    const base = basename(src);
    if (!base || !isAbsolute(src)) {
      errors.push(`無效來源：${src}`);
      continue;
    }
    try {
      const name = await uniqueName(safe.abs, base);
      await fsp.cp(src, join(safe.abs, name), { recursive: true, errorOnExist: true, force: false });
      names.push(name);
      imported += 1;
    } catch (e) {
      errors.push(`${base}：${fsOpError(e)}`);
    }
  }
  return errors.length ? { imported, names, errors } : { imported, names };
}

/** 讀試算表（xlsx/xls/xlsm/...）→ 每工作表的儲存格字串矩陣（唯讀預覽）。大檔限前 MAX_SHEET_ROWS 列避免卡死。 */
const MAX_SHEET_ROWS = 5000;
export async function readSheet(
  mgr: WorkspaceManager,
  wsId: string,
  p: string,
): Promise<{ sheets: { name: string; rows: string[][] }[] } | { error: string }> {
  const safe = resolveSafe(mgr, wsId, p);
  if ('error' in safe) return { error: '路徑超出工作區範圍' };
  try {
    const buf = await fsp.readFile(safe.abs);
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellFormula: false, cellHTML: false });
    const sheets = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const raw = (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) as unknown[][]).slice(0, MAX_SHEET_ROWS);
      return { name, rows: raw.map((r) => r.map((c) => (c == null ? '' : String(c)))) };
    });
    return { sheets };
  } catch (e) {
    return { error: fsOpError(e) };
  }
}

/**
 * 讀 Word 文件唯讀預覽：docx/docm → mammoth 轉語意 HTML（圖片預設內嵌 base64 data URI）；
 * doc（舊二進位格式）→ word-extractor 抽純文字（無圖無格式）。HTML 由 renderer 端 dompurify
 * 消毒後才渲染（此處不信任文件內容）。
 */
export async function readDoc(
  mgr: WorkspaceManager,
  wsId: string,
  p: string,
): Promise<{ kind: 'html'; html: string } | { kind: 'text'; text: string } | { error: string }> {
  const safe = resolveSafe(mgr, wsId, p);
  if ('error' in safe) return { error: '路徑超出工作區範圍' };
  try {
    const buf = await fsp.readFile(safe.abs);
    if (/\.(docx|docm)$/i.test(p)) {
      const r = await mammoth.convertToHtml({ buffer: buf });
      return { kind: 'html', html: r.value };
    }
    const doc = await new WordExtractor().extract(buf);
    return { kind: 'text', text: doc.getBody() };
  } catch (e) {
    return { error: fsOpError(e) };
  }
}

/** 測試輔助：清空模組級版本指紋狀態。 */
export function __resetFileServiceState(): void {
  readVersions.clear();
}

/** 註冊 fs:read / fs:write（取代 stub 的 fs read/write；fs:tree 由 F-2 提供）。 */
export function registerFileService(ipc: IpcMain, workspaces: WorkspaceManager): void {
  ipc.handle('fs:read', (_e, req: InvokeReq<'fs:read'>) => readFileSafe(workspaces, req));
  ipc.handle('fs:write', (_e, req: InvokeReq<'fs:write'>) => writeFileSafe(workspaces, req));
  ipc.handle('fs:create', (_e, req: InvokeReq<'fs:create'>) => createEntry(workspaces, req.wsId, req.path, req.dir));
  ipc.handle('fs:rename', (_e, req: InvokeReq<'fs:rename'>) => renameEntry(workspaces, req.wsId, req.from, req.to));
  ipc.handle('fs:delete', (_e, req: InvokeReq<'fs:delete'>) => deleteEntry(workspaces, req.wsId, req.path));
  ipc.handle('fs:copy', (_e, req: InvokeReq<'fs:copy'>) => copyEntry(workspaces, req.wsId, req.from, req.to));
  ipc.handle('fs:importFiles', (_e, req: InvokeReq<'fs:importFiles'>) => importFiles(workspaces, req.wsId, req.destDir, req.sources));
  ipc.handle('fs:readSheet', (_e, req: InvokeReq<'fs:readSheet'>) => readSheet(workspaces, req.wsId, req.path));
  ipc.handle('fs:readDoc', (_e, req: InvokeReq<'fs:readDoc'>) => readDoc(workspaces, req.wsId, req.path));
  ipc.handle('fs:openExternal', async (_e, req: InvokeReq<'fs:openExternal'>) => {
    const safe = resolveSafe(workspaces, req.wsId, req.path);
    if ('error' in safe) return { error: '路徑超出工作區範圍' } as const;
    const err = await shell.openPath(safe.abs); // '' = 成功，否則為錯誤訊息
    return err ? ({ error: err } as const) : ({ ok: true } as const);
  });
  ipc.handle('fs:reveal', (_e, req: InvokeReq<'fs:reveal'>) => {
    const safe = resolveSafe(workspaces, req.wsId, req.path);
    if ('error' in safe) return { error: '路徑超出工作區範圍' } as const;
    shell.showItemInFolder(safe.abs);
    return { ok: true } as const;
  });
}
