// 建立 worktree 的送出動作（與 React 解耦，便於單測紅軍 A2/A3）：
// - A3 防重入：閉包 inFlight 旗標，前一次未 settle 前的重複呼叫回 ignored（不再發 worktreeAdd）。
// - A2 TOCTOU：送出當下重抓 worktreeList、以最新快照複查互斥（非開窗快照）。
import { isBranchTaken, type BranchSourceKind } from './worktreeModel';
import type { GitWorktree } from '../../../shared/types';

export interface CreateDeps {
  worktreeList: (wsId: string) => Promise<{ list: GitWorktree[] } | { error: string }>;
  worktreeAdd: (args: {
    wsId: string;
    branch: { kind: BranchSourceKind; name: string; base?: string };
    path: string;
  }) => Promise<{ wsId: string } | { error: string; code?: 'branch-taken' | 'path-exists' | 'net' | 'invalid-path' }>;
}

export type CreateResult =
  | { kind: 'ignored' }
  | { kind: 'conflict'; branch: string; at: string }
  | { kind: 'ok'; wsId: string }
  | { kind: 'error'; message: string; code?: 'branch-taken' | 'path-exists' | 'net' | 'invalid-path' };

export interface CreateParams {
  wsId: string;
  branch: { kind: BranchSourceKind; name: string; base?: string };
  path: string;
}

/** 把 CreateResult 的 error code 映射成友善訊息＋是否可重試（紅軍 A5：net→retry；REQ-WT-010/013）。 */
export function friendlyCreateError(
  code: 'branch-taken' | 'path-exists' | 'net' | 'invalid-path' | undefined,
  raw: string,
): { msg: string; retry: boolean } {
  switch (code) {
    case 'branch-taken':
      return { msg: '該分支已被其他 worktree 簽出。請選其他分支或改用「跳到該 worktree」。', retry: false };
    case 'path-exists':
      return { msg: '目標資料夾已存在。請改用其他路徑。', retry: false };
    case 'net':
      return { msg: '無法建立本地追蹤分支（網路問題）。請檢查連線後重試。', retry: true };
    case 'invalid-path':
      return { msg: `目標路徑不合法：${raw}`, retry: false };
    default:
      return { msg: raw, retry: true };
  }
}

/** 建一個帶防重入的送出動作。React 端於整個對話框生命週期共用同一個實例（useRef/useMemo）。 */
export function makeCreateAction(deps: CreateDeps): (params: CreateParams) => Promise<CreateResult> {
  let inFlight = false;
  return async function create(params: CreateParams): Promise<CreateResult> {
    if (inFlight) return { kind: 'ignored' }; // A3：前次未 settle → 忽略重複點擊/Enter
    inFlight = true;
    try {
      // A2：送出當下重抓最新 worktree 快照複查互斥（使用者可能在終端機手動 checkout 繞過佇列）。
      const wt = await deps.worktreeList(params.wsId);
      if ('list' in wt) {
        const t = isBranchTaken(params.branch.name, wt.list);
        if (t.taken) return { kind: 'conflict', branch: params.branch.name, at: t.at };
      }
      const res = await deps.worktreeAdd({ wsId: params.wsId, branch: params.branch, path: params.path });
      if ('wsId' in res) return { kind: 'ok', wsId: res.wsId };
      return { kind: 'error', message: res.error, code: res.code };
    } finally {
      inFlight = false;
    }
  };
}
