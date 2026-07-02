// worktree 目標路徑純函式（REQ-WT-010/015；紅軍 A1/A3 防禦落點）：
// - branchSlug：分支名→Windows 安全資料夾名（trim 先於保留名判定＝A3 roundtrip 不變性）
// - validateWorktreeTarget：lexical 檢查外加 realpath 祖先鏈解析（A1：junction/symlink/8.3 短名
//   不能把目標「偽裝」到系統目錄/工作區內部之外）、UNC/裝置前綴一律拒、可注入 blockedDirs。
// I/O（exists/realpath）可注入供測試；預設 node:fs。

import { resolve, join, dirname, basename, parse as parsePath, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
// slug/sibling 命名＝純邏輯，抽到 shared（renderer 也 import；避免把 node:fs 拉進 renderer bundle）。
import { branchSlug, defaultWorktreeBase } from '../../shared/worktreeNaming';

export { branchSlug, defaultWorktreeBase };

/** 完整路徑預檢上限（MAX_PATH 260 留 buffer 給 repo 內部深層檔案）。 */
const MAX_PATH_LEN = 240;

/** 目標＝base/slug；已存在則 -2、-3…（REQ-WT-010 序號策略；slug 碰撞同走此路）。 */
export function resolveTargetPath(baseDir: string, slug: string, exists: (p: string) => boolean): string {
  const first = join(baseDir, slug);
  if (!exists(first)) return first;
  for (let i = 2; i <= 99; i++) {
    const candidate = join(baseDir, `${slug}-${i}`);
    if (!exists(candidate)) return candidate;
  }
  // 99 個同名候選全被占：交回呼叫端當一般失敗處理（不無限迴圈）
  return join(baseDir, `${slug}-${Date.now()}`);
}

export type WorktreeTargetValidation =
  | { ok: true; abs: string }
  | { ok: false; reason: 'inside-workspace' | 'system' | 'too-long' | 'invalid' };

export interface WorktreeTargetOpts {
  /** 額外禁用目錄（如 app userData）。 */
  blockedDirs?: string[];
  /** I/O 注入（測試用）；預設 node:fs。 */
  io?: { exists: (p: string) => boolean; realpath: (p: string) => string };
}

const WIN_SYSTEM_DIRS = ['windows', 'program files', 'program files (x86)', 'programdata'];
const POSIX_SYSTEM_DIRS = ['/etc', '/usr', '/bin', '/sbin', '/var', '/boot', '/lib', '/opt'];

const defaultIo = {
  exists: existsSync,
  // realpathSync.native：Windows 下額外展開 8.3 短名（PROGRA~1 → Program Files）
  realpath: (p: string): string => (realpathSync.native ?? realpathSync)(p),
};

/** 目標可能尚不存在：realpath 最深「存在的祖先」再拼回剩餘段（A1：解 junction/symlink/短名）。 */
function realizeDeepestAncestor(abs: string, io: NonNullable<WorktreeTargetOpts['io']>): string {
  let base = abs;
  const rest: string[] = [];
  while (!io.exists(base)) {
    const parent = dirname(base);
    if (parent === base) return abs; // 到根仍不存在：維持 lexical（後續檢查照跑）
    rest.unshift(basename(base));
    base = parent;
  }
  try {
    return join(io.realpath(base), ...rest);
  } catch {
    return abs;
  }
}

/**
 * 目標路徑安全驗證（REQ-WT-015＋紅軍 A1）：
 * ① UNC/裝置前綴（\\?\、\\.\、\\server）一律拒（僅支援本機一般路徑）
 * ② realpath 祖先鏈解析後，拒 >240、磁碟根/系統目錄/Start Menu/blockedDirs、既有工作區內部。
 */
export function validateWorktreeTarget(
  p: unknown,
  workspacePaths: string[],
  opts?: WorktreeTargetOpts,
): WorktreeTargetValidation {
  if (typeof p !== 'string' || p.trim() === '') return { ok: false, reason: 'invalid' };
  const raw = p.trim();
  if (/^[\\/]{2}/.test(raw)) return { ok: false, reason: 'invalid' }; // UNC / \\?\ / \\.\
  const io = opts?.io ?? defaultIo;

  const resolved = resolve(raw);
  // 先判磁碟根（strip 尾斜線前）：`C:\` strip 後變 `C:`＝drive-relative 會解到 cwd 逃逸根檢查。
  if (resolved === parsePath(resolved).root) return { ok: false, reason: 'system' };
  const lexical = resolved.replace(/[\\/]+$/, '');
  if (lexical.length === 0) return { ok: false, reason: 'invalid' };
  const abs = realizeDeepestAncestor(lexical, io).replace(/[\\/]+$/, '');
  if (/^[\\/]{2}/.test(abs)) return { ok: false, reason: 'invalid' }; // realpath 解到 UNC 也拒
  if (abs.length > MAX_PATH_LEN) return { ok: false, reason: 'too-long' };

  const isWin = process.platform === 'win32';
  const lower = (s: string): string => (isWin ? s.toLowerCase() : s);
  const norm = lower(abs);
  const { root } = parsePath(abs);
  const rootNorm = lower(root).replace(/[\\/]+$/, '');
  if (norm === rootNorm) return { ok: false, reason: 'system' };
  const under = (base: string): boolean => norm === base || norm.startsWith(base + sep);

  const systemBases = isWin
    ? WIN_SYSTEM_DIRS.map((d) => `${rootNorm}${sep}${d}`)
    : POSIX_SYSTEM_DIRS.slice();
  // Windows Startup / Start Menu（A1：checkout 進去＝登入自動執行的持久化）
  if (isWin && process.env.APPDATA) {
    systemBases.push(lower(join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu')));
  }
  for (const extra of opts?.blockedDirs ?? []) {
    systemBases.push(lower(resolve(extra)).replace(/[\\/]+$/, ''));
  }
  if (systemBases.some(under)) return { ok: false, reason: 'system' };

  for (const ws of workspacePaths) {
    let wsAbs = resolve(ws);
    try {
      wsAbs = io.exists(wsAbs) ? io.realpath(wsAbs) : wsAbs;
    } catch {
      /* 工作區路徑 realpath 失敗：用 lexical */
    }
    const wsNorm = lower(wsAbs).replace(/[\\/]+$/, '');
    if (under(wsNorm)) return { ok: false, reason: 'inside-workspace' };
  }
  return { ok: true, abs };
}
