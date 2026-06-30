// Claude hook 狀態聚合（純函式，可單測）。把各 session 的 hook 狀態（working/awaiting/done）對應到
// 工作區的 ClaudeState：cwd→工作區（最長路徑前綴）、綜合多 session 取優先序、無 alive PTY 一律 idle。

import type { AiTool, ClaudeState } from '../../shared/types';

/** 單一 AI session 的狀態（claude 由 hook 腳本寫的狀態檔；codex 由解析 rollout 得出）。 */
export interface SessionStatus {
  sessionId: string;
  cwd: string;
  state: 'working' | 'awaiting' | 'done';
  ts: number;
  /** 來源工具；undefined 視為 claude（向後相容既有 hook 狀態檔來源）。 */
  tool?: AiTool;
}

/** hook 狀態字串 → ClaudeState（未知 → idle）。 */
export function hookStateToClaude(s: string): ClaudeState {
  switch (s) {
    case 'working':
      return 'running';
    case 'awaiting':
      return 'stopped-await';
    case 'done':
      return 'done';
    default:
      return 'idle';
  }
}

/** 路徑正規化比較用（Windows 大小寫不敏感、統一 forward slash、去尾斜線）。 */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** cwd 屬於哪個工作區（工作區 path 為 cwd 之前綴或相等；最長前綴勝）。無對應回 null。 */
export function matchWorkspace(cwd: string, workspaces: readonly { id: string; path: string }[]): string | null {
  const c = norm(cwd);
  let best: { id: string; len: number } | null = null;
  for (const ws of workspaces) {
    if (!ws.path) continue;
    const p = norm(ws.path);
    if (c === p || c.startsWith(`${p}/`)) {
      if (!best || p.length > best.len) best = { id: ws.id, len: p.length };
    }
  }
  return best ? best.id : null;
}

const RANK: Record<ClaudeState, number> = { running: 3, 'stopped-await': 2, done: 1, idle: 0 };

/** working 殘留的最終保險時效：超過此值沒更新的「執行中」視為殘留 → 降級已停止。
 * 保守 30 分鐘：長到幾乎不誤判正常長任務（單一 hook 間隔 >30min 極罕見），仍能兜住 SessionStart/End 沒清到的殘留。 */
const WORKING_STALE_MS = 30 * 60 * 1000;

/**
 * 某工作區綜合狀態：無 alive PTY → idle（沒終端機就不可能有 claude；清掉 hook 殘留）；
 * 否則取該工作區所有 session 的最高優先序（執行中 > 待確認 > 已停止）；無 session → idle（未啟動）。
 * working 殘留保險：太久沒更新的「執行中」降級為已停止（SessionStart 清殘留、SessionEnd 刪檔之外的最終防線）。
 */
export function computeWorkspaceState(
  hasAlivePty: boolean,
  sessions: readonly SessionStatus[],
  now: number = Date.now(),
): ClaudeState {
  if (!hasAlivePty) return 'idle';
  let best: ClaudeState = 'idle';
  for (const s of sessions) {
    let st = hookStateToClaude(s.state);
    if (st === 'running' && s.ts > 0 && now - s.ts > WORKING_STALE_MS) st = 'done';
    if (RANK[st] > RANK[best]) best = st;
  }
  return best;
}

/**
 * 聚合所有工作區狀態：每個 session 依 cwd 歸戶到工作區，再逐工作區算綜合狀態。
 * 回傳 Map<wsId, ClaudeState>（涵蓋傳入的每個工作區）。
 */
export function aggregateWorkspaceStates(
  workspaces: readonly { id: string; path: string }[],
  sessions: readonly SessionStatus[],
  hasAlivePty: (wsId: string) => boolean,
  now: number = Date.now(),
): Map<string, ClaudeState> {
  const byWs = new Map<string, SessionStatus[]>();
  for (const s of sessions) {
    const wsId = matchWorkspace(s.cwd, workspaces);
    if (!wsId) continue;
    const arr = byWs.get(wsId);
    if (arr) arr.push(s);
    else byWs.set(wsId, [s]);
  }
  const out = new Map<string, ClaudeState>();
  for (const ws of workspaces) {
    out.set(ws.id, computeWorkspaceState(hasAlivePty(ws.id), byWs.get(ws.id) ?? [], now));
  }
  return out;
}

/** 監控涵蓋的工具（每工作區都對這些工具各算一個狀態）。 */
export const AI_TOOLS: readonly AiTool[] = ['claude', 'codex'];

/**
 * 工具中立聚合：每個 session 依 cwd 歸戶工作區、依 tool 分組，逐 (工作區,工具) 算綜合狀態。
 * 回 Map<wsId, Map<tool, ClaudeState>>（每工作區涵蓋 AI_TOOLS 全部工具，無 session→idle）。
 * idle 閘門（hasAlivePty）工具中立：無 alive PTY 則該工作區所有工具皆 idle。
 */
export function aggregateByTool(
  workspaces: readonly { id: string; path: string }[],
  sessions: readonly SessionStatus[],
  hasAlivePty: (wsId: string) => boolean,
  now: number = Date.now(),
): Map<string, Map<AiTool, ClaudeState>> {
  const byKey = new Map<string, SessionStatus[]>(); // key = `${wsId}::${tool}`
  for (const s of sessions) {
    const wsId = matchWorkspace(s.cwd, workspaces);
    if (!wsId) continue;
    const key = `${wsId}::${s.tool ?? 'claude'}`;
    const arr = byKey.get(key);
    if (arr) arr.push(s);
    else byKey.set(key, [s]);
  }
  const out = new Map<string, Map<AiTool, ClaudeState>>();
  for (const ws of workspaces) {
    const alive = hasAlivePty(ws.id);
    const toolMap = new Map<AiTool, ClaudeState>();
    for (const tool of AI_TOOLS) {
      toolMap.set(tool, computeWorkspaceState(alive, byKey.get(`${ws.id}::${tool}`) ?? [], now));
    }
    out.set(ws.id, toolMap);
  }
  return out;
}
