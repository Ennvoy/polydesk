// worktree 建立對話框的純邏輯（無 React/DOM）——抽出以便 vitest 單測（紅軍攻擊面落點）。
// 前端 validateRef 須與 main 端 gitSafeArgs.validateRef 規則一致（不可寬鬆放行讓 main 才擋 = 體驗差、
// 也不可誤擋合法名）；互斥判斷、路徑預覽、送出前複查皆在此。

import { branchSlug, defaultWorktreeBase } from '../../../shared/worktreeNaming';
import { neutralizeBidi } from '../Dialogs/TrustConfirm';

export type BranchSourceKind = 'existing' | 'new' | 'remote';

/**
 * 前端分支名即時驗證：與 main 端 validateRef 同規則（白名單）。回 null=合法、否則回中文原因。
 * 刻意複製規則而非 import main（renderer 不載 main 模組）；由 worktreeModel.test 對拍一致性。
 */
export function branchNameError(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0) return '請輸入分支名';
  if (name.length > 255) return '分支名過長（上限 255）';
  if (name === 'HEAD' || name === '@') return '不可用保留名 HEAD/@';
  for (const ch of name) {
    const c = ch.codePointAt(0);
    if (c === undefined || c < 0x20 || c === 0x7f) return '不可含控制字元';
  }
  if (/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(name)) return '不可含隱形/雙向文字字元';
  if (/[ \t~^:?*[\]\\+]/.test(name)) return '不可含空白或 ~ ^ : ? * [ ] \\ + 等字元';
  if (name.startsWith('-')) return '不可用 - 開頭';
  if (name.startsWith('/') || name.endsWith('/')) return '不可用 / 開頭或結尾';
  if (name.startsWith('.') || name.endsWith('.')) return '不可用 . 開頭或結尾';
  if (name.includes('..')) return '不可含連續 ..';
  if (name.includes('//')) return '不可含連續 //';
  if (name.includes('@{')) return '不可含 @{';
  for (const part of name.split('/')) {
    if (part.length === 0) return '路徑段不可為空';
    if (part.startsWith('.')) return '路徑段不可用 . 開頭';
    if (part.endsWith('.lock')) return '路徑段不可用 .lock 結尾';
  }
  return null;
}

/** origin/feat/x → feat/x（去第一段 remote 名）；供 remote 來源建立本地追蹤分支的預設名。 */
export function localNameFromRemote(remoteRef: string): string {
  const idx = remoteRef.indexOf('/');
  return idx >= 0 ? remoteRef.slice(idx + 1) : remoteRef;
}

/** 已被任一工作樹簽出的分支集合（用於選單禁選；比對去 refs/heads/ 後的短名）。 */
export function checkedOutBranches(worktrees: { branch: string | null }[]): Set<string> {
  return new Set(worktrees.map((w) => w.branch).filter((b): b is string => !!b));
}

/**
 * 紅軍 A2：送出前以「最新」worktree 快照重算某分支是否已被簽出，回佔用路徑。
 * 呼叫端須傳送出當下重抓的 list（非開窗快照），避免 TOCTOU。
 */
export function isBranchTaken(
  branch: string,
  worktrees: { branch: string | null; path: string }[],
): { taken: true; at: string } | { taken: false } {
  const hit = worktrees.find((w) => w.branch === branch);
  return hit ? { taken: true, at: hit.path } : { taken: false };
}

/**
 * 決定「送出用的分支描述」+ 資料夾 slug 來源名。
 * - existing：name=選中分支；slug 來源=該分支
 * - new：name=輸入新名；slug=新名；base=起點
 * - remote：name=本地追蹤分支名（localNameFromRemote）；slug=該名；base=origin/xxx
 */
export function buildBranchSpec(
  kind: BranchSourceKind,
  input: { existing?: string; newName?: string; base?: string; remoteRef?: string },
): { branch: { kind: BranchSourceKind; name: string; base?: string }; slugSource: string } | { error: string } {
  if (kind === 'existing') {
    const name = input.existing?.trim() ?? '';
    if (!name) return { error: '請選擇要簽出的分支' };
    return { branch: { kind, name }, slugSource: name };
  }
  if (kind === 'new') {
    const name = input.newName?.trim() ?? '';
    const err = branchNameError(name);
    if (err) return { error: err };
    if (input.base !== undefined && input.base !== '' && branchNameError(input.base)) {
      return { error: '起點分支名不合法' };
    }
    return { branch: { kind, name, base: input.base || undefined }, slugSource: name };
  }
  // remote
  const remoteRef = input.remoteRef?.trim() ?? '';
  if (!remoteRef) return { error: '請選擇 remote 分支' };
  const local = localNameFromRemote(remoteRef);
  const err = branchNameError(local);
  if (err) return { error: `remote 分支名無法作為本地分支：${err}` };
  return { branch: { kind, name: local, base: remoteRef }, slugSource: local };
}

/**
 * 紅軍 A1：rail worktree 徽章的顯示文字。分支名一律經 neutralizeBidi（剝 RLO 等視覺欺騙字元）；
 * React 文字節點負責 HTML 跳脫（禁 dangerouslySetInnerHTML）。detached(null) 顯示明確文字、不渲染 'null'、
 * 不由資料夾名回推；載入中(undefined) 顯示 '…'。
 */
export function worktreeBranchDisplay(branch: string | null | undefined): string {
  if (branch === undefined) return '…';
  if (branch === null) return '(detached HEAD)';
  return neutralizeBidi(branch);
}

/** 紅軍 A5：worktree 路徑顯示同樣經 neutralizeBidi（RLO 可把 exe.taeic 偽裝成 taeic.exe 誘導誤刪）。 */
export function worktreePathDisplay(path: string): string {
  return neutralizeBidi(path ?? '');
}

/** 紅軍 A3：可否「切換到此」。主工作樹本身不切；失效登記(prunable)不切（資料夾已不在，開了是 missing）。 */
export function canSwitchWorktree(wt: { isMain: boolean; prunable: boolean }): boolean {
  return !wt.isMain && !wt.prunable;
}

/** 預設目標路徑：sibling base + branchSlug（前端預覽用；main 端仍 validateWorktreeTarget 把關）。 */
export function previewTargetPath(mainPath: string, slugSource: string): string {
  const base = defaultWorktreeBase(mainPath);
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${branchSlug(slugSource || 'wt')}`;
}
