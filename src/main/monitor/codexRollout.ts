// codex 狀態來源：解析 codex 自己即時寫的 rollout JSONL（不需注入 hooks、不碰 config.toml、不會卡死 codex）。
//
// codex 每個 session（含使用者手打的 TUI）寫 ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl，逐行串流：
//   - 第1行 session_meta：payload.cwd = 工作區、payload.id = session id。
//   - event_msg/task_started → 一個 turn 開始（執行中）。
//   - event_msg/task_complete → turn 結束（已停止/等你輸入）。
//   - 其餘 response_item/function_call、agent_message 等 = turn 進行中（執行中）。
//   - 每行有 top-level ISO `timestamp`。
//
// 取尾端最後出現的 task_started/task_complete 決定 working/done；只回報「近期還在更新（mtime 在窗內）」的
// rollout，超窗視為該 session 已結束 → 不回報，交給 monitor 的 hasAlivePty/idle 閘門。
// codex（你的 full-access 設定）幾乎不進 awaiting（不會停下來問），故僅 working/done 兩態 + idle 閘門。

import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionStatus } from './claudeHookState';

/** 只回報「mtime 在此窗內（近期還在更新）」的 rollout；超窗視為 session 已結束。 */
const CODEX_ACTIVE_MS = 10 * 60 * 1000;
/** tail 讀尾端位元組數（涵蓋最後一個 turn 的邊界事件；codex event 行通常數百 bytes）。 */
const TAIL_BYTES = 64 * 1024;

/** 從 rollout 第1行（session_meta）取 cwd。 */
export function parseSessionMetaCwd(firstLine: string): string | null {
  try {
    const j = JSON.parse(firstLine) as { payload?: { cwd?: unknown } };
    return typeof j.payload?.cwd === 'string' ? j.payload.cwd : null;
  } catch {
    return null;
  }
}

/**
 * 從 rollout 尾端文字解析狀態：最後的 task_started→working、task_complete→done；
 * 尾端有活動但沒掃到 task 邊界（turn 很長、邊界在更前面）→ 保守視為進行中（working）。
 * 回 null 表示尾端沒有可辨識的活動。
 */
export function parseRolloutTail(tailText: string): { state: 'working' | 'done'; ts: number } | null {
  const lines = tailText.split('\n');
  let lastTask: { done: boolean; ts: number } | null = null;
  let lastActivityTs = 0;
  let sawActivity = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let j: { timestamp?: string; type?: string; payload?: { type?: string } };
    try {
      j = JSON.parse(s);
    } catch {
      continue; // tail 可能從半行切起 → skip
    }
    const ts = j.timestamp ? Date.parse(j.timestamp) || 0 : 0;
    const pt = j.payload?.type;
    if (pt === 'task_started') lastTask = { done: false, ts };
    else if (pt === 'task_complete' || pt === 'turn_complete' || pt === 'turn_aborted' || pt === 'turn_end')
      lastTask = { done: true, ts }; // turn 正常結束/中止皆＝已停止
    if (j.type === 'response_item' || j.type === 'event_msg') {
      sawActivity = true;
      if (ts > lastActivityTs) lastActivityTs = ts;
    }
  }
  if (lastTask) return { state: lastTask.done ? 'done' : 'working', ts: lastTask.ts || lastActivityTs };
  if (sawActivity) return { state: 'working', ts: lastActivityTs };
  return null;
}

/** codex sessions 根目錄。 */
export function codexSessionsRoot(home: string = homedir()): string {
  return join(home, '.codex', 'sessions');
}

/** 最近兩天的 YYYY/MM/DD 目錄（codex sessions 巢狀；跨午夜也涵蓋）。 */
function recentDayDirs(root: string, now: number): string[] {
  const out: string[] = [];
  for (let d = 0; d < 2; d++) {
    const date = new Date(now - d * 24 * 60 * 60 * 1000);
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    out.push(join(root, y, m, day));
  }
  return out;
}

/** rollout 檔名取 session id（rollout-<ts>-<uuid>.jsonl）。 */
function sessionIdFromName(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const m = base.match(/rollout-.*?-([0-9a-f-]{36})\.jsonl$/i);
  return m ? m[1] : base;
}

/** 讀第1行（session_meta；含 base_instructions 可能很長 → 分塊讀到第一個換行，最多 maxBytes）。 */
async function readFirstLine(path: string, maxBytes = 512 * 1024): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const CHUNK = 16 * 1024;
    let acc = '';
    let pos = 0;
    while (pos < maxBytes) {
      const buf = Buffer.alloc(CHUNK);
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos);
      if (bytesRead === 0) break;
      acc += buf.toString('utf8', 0, bytesRead);
      const nl = acc.indexOf('\n');
      if (nl >= 0) return acc.slice(0, nl);
      pos += bytesRead;
    }
    return acc;
  } finally {
    await fh.close();
  }
}

/** 讀檔尾 N bytes。 */
async function readTail(path: string, size: number, bytes: number): Promise<string> {
  const start = Math.max(0, size - bytes);
  const len = size - start;
  if (len <= 0) return '';
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * 掃近期活躍的 codex rollout → SessionStatus[]（tool=codex）。
 * 只看最近兩天目錄（避免掃歷史全部）+ mtime 在 CODEX_ACTIVE_MS 內的檔；同 cwd 取 mtime 最新。
 * 任一步失敗都略過該檔（永不丟例外），讓監控容錯。
 */
export async function readCodexSessions(
  root: string = codexSessionsRoot(),
  now: number = Date.now(),
): Promise<SessionStatus[]> {
  const candidates: { path: string; mtime: number; size: number }[] = [];
  for (const dir of recentDayDirs(root, now)) {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue; // 目錄不存在（當天沒 codex 跑過）
    }
    for (const f of files) {
      if (!f.startsWith('rollout-') || !f.endsWith('.jsonl')) continue;
      const path = join(dir, f);
      try {
        const st = await stat(path);
        if (now - st.mtimeMs <= CODEX_ACTIVE_MS) candidates.push({ path, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* skip */
      }
    }
  }
  // 同 cwd 取 mtime 最新（一個工作區只算最新活躍 session）。
  const byCwd = new Map<string, SessionStatus>();
  for (const c of candidates.sort((a, b) => b.mtime - a.mtime)) {
    try {
      const cwd = parseSessionMetaCwd(await readFirstLine(c.path));
      if (!cwd) continue;
      const key = cwd.toLowerCase();
      if (byCwd.has(key)) continue; // 已有更新的同 cwd
      const parsed = parseRolloutTail(await readTail(c.path, c.size, TAIL_BYTES));
      if (!parsed) continue;
      byCwd.set(key, { sessionId: sessionIdFromName(c.path), cwd, state: parsed.state, ts: parsed.ts || c.mtime, tool: 'codex' });
    } catch {
      /* skip 壞檔 */
    }
  }
  return [...byCwd.values()];
}
