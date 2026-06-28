// 語言伺服器探測（F-5：REQ-EDIT-004）+ 安全執行檔解析（紅軍 F-5-A2）。
//
// 威脅模型：languageRegistry 的 cmd 是裸執行檔名（gopls / clangd …）。Windows 執行檔搜尋會先掃
// 「目前工作目錄」與 `where` 也會列 cwd；若攻擊者在 repo 根放 gopls.exe / gopls.cmd（PATHEXT 命中），
// 以 cwd=工作區 spawn 裸名就會執行 repo 內的劫持檔（開檔即 RCE）。
//
// 防禦：自行掃 process.env.PATH 的目錄（絕不掃 cwd / '.'，也不呼叫 `where`），逐目錄找
// 「name(+PATHEXT)」的存在檔，回「絕對路徑」；任何落在 excludeDirs（工作區根樹）內的候選一律跳過。
// LspManager 一律以本函式回的絕對路徑 + shell:false spawn，故裸名永遠不進 spawn。

import { existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { LspServerInfo } from '../../shared/types';
import { byLangId } from './languageRegistry';

export interface ProbeDeps {
  /** 掃描的目錄清單（預設 process.env.PATH 切分）。注入以利測試。 */
  pathDirs?: string[];
  /** 候選副檔名（Windows 預設 PATHEXT；其他平台 ['']）。 */
  pathExts?: string[];
  /** 檔案存在判定（預設 existsSync + isFile）。 */
  exists?: (p: string) => boolean;
  /** 需排除的目錄（工作區根/ cwd）；候選落在其內一律跳過。 */
  excludeDirs?: string[];
  /** 平台（預設 process.platform）。 */
  platform?: NodeJS.Platform;
}

function defaultPathDirs(): string[] {
  const raw = process.env.PATH ?? process.env.Path ?? '';
  return raw.split(delimiter).filter((d) => d.length > 0);
}

function defaultPathExts(platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [''];
  const raw = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  // 同時允許「無副檔名」命中（PATH 內可能放無副檔名的 wrapper），但裸 cwd 不在掃描範圍。
  return ['', ...raw.split(';').filter((e) => e.length > 0)];
}

function defaultExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/** target 是否等於或落在 parent 內（含 parent 本身）。 */
function isWithinOrEqual(parent: string, target: string): boolean {
  const rel = relative(parent, target);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/**
 * 在 PATH 目錄中解析 name 的絕對路徑（排除 excludeDirs；絕不掃 cwd）。找不到回 null。
 * 純掃描 + 注入式，可單元測試（紅軍 F-5-A2 的核心防禦）。
 */
export function resolveOnPath(name: string, deps: ProbeDeps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  const dirs = deps.pathDirs ?? defaultPathDirs();
  const exts = deps.pathExts ?? defaultPathExts(platform);
  const exists = deps.exists ?? defaultExists;
  const exclude = (deps.excludeDirs ?? []).map((d) => resolve(d));

  for (const rawDir of dirs) {
    if (!rawDir) continue;
    const dir = resolve(rawDir);
    // 跳過被劫持風險目錄（工作區根/cwd 或其子目錄）
    if (exclude.some((ex) => isWithinOrEqual(ex, dir))) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (!exists(candidate)) continue;
      // 縱深防衛：候選實體路徑仍不得落在排除目錄內
      if (exclude.some((ex) => isWithinOrEqual(ex, candidate))) continue;
      return candidate;
    }
  }
  return null;
}

/**
 * 探測某 langId 的語言伺服器是否可用（REQ-EDIT-004）。
 * 偵測不到 → available:false（不擋路、由 renderer 顯示缺件提示）。
 */
export function probeServer(langId: string, deps: ProbeDeps = {}): LspServerInfo {
  const desc = byLangId(langId);
  if (!desc) return { langId, available: false, installable: false };
  const command = resolveOnPath(desc.cmd, deps);
  return {
    langId,
    available: command !== null,
    command: command ?? undefined,
    installable: desc.installable,
    installHint: desc.installHint,
  };
}
