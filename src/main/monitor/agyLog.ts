// Agy 狀態來源：讀 ~/.gemini/antigravity-cli/log/cli-*.log。
// 只接受明確事件：Streaming conversation=執行中、待核准訊息=待確認、Stream completed=已停止。
// 不解析 TUI 畫面、不用靜默時間猜狀態；Agy 版本改字串時會保守退回 done，而不製造假的待確認。

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { SessionStatus } from './claudeHookState';

const AGY_ACTIVE_MS = 12 * 60 * 60 * 1000;

export function agyLogRoot(home: string = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli', 'log');
}

/** 單一 Agy CLI log 解析；沒有 workspace 就不是可歸戶的 session。 */
export function parseAgyLog(text: string, fallbackTs = 0): SessionStatus | null {
  const ws = text.match(/workspaceDirs=\[([^\]\r\n]+)\]/)?.[1]?.trim();
  if (!ws) return null;
  let state: SessionStatus['state'] = 'done'; // CLI 剛開、停在輸入列
  let sessionId = `agy-log:${ws}`;
  let ts = fallbackTs;
  for (const line of text.split(/\r?\n/)) {
    const stamp = line.match(/^[IWEF](\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
    if (stamp && fallbackTs) {
      const d = new Date(fallbackTs);
      d.setMonth(Number(stamp[1]) - 1, Number(stamp[2]));
      d.setHours(Number(stamp[3]), Number(stamp[4]), Number(stamp[5]), Number(stamp[6].slice(0, 3).padEnd(3, '0')));
      ts = d.getTime();
    }
    const streaming = line.match(/Streaming conversation ([0-9a-f-]{36})/i);
    if (streaming) {
      sessionId = streaming[1];
      state = 'working';
      continue;
    }
    if (/Stream completed for [0-9a-f-]{36}/i.test(line)) {
      state = 'done';
      continue;
    }
    // 已核准代表工作繼續；Auto-approving 本身從未進入待確認。
    if (/Tool confirmation for conversation .*approved=(?:true|false)/i.test(line) || /Auto-approving tool confirmation/i.test(line)) {
      state = 'working';
      continue;
    }
    // 相容不同 Agy 版本可能使用的明確等待字樣；刻意不匹配啟動設定 toolPermission=request-review。
    if (
      /Surfacing tool confirmation:/i.test(line) ||
      /(?:waiting for|awaiting|requesting|requested|requires?) (?:user )?(?:tool )?(?:confirmation|approval|permission)/i.test(line) ||
      /(?:tool )?(?:confirmation|approval|permission) (?:is )?(?:pending|required|requested)/i.test(line)
    ) {
      state = 'awaiting';
    }
  }
  return { sessionId, cwd: ws, state, ts, tool: 'agy' };
}

/** 掃近期 Agy logs；同 workspace 只取 mtime 最新的一個。 */
export async function readAgySessions(root: string = agyLogRoot(), now: number = Date.now()): Promise<SessionStatus[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const candidates: { path: string; mtime: number }[] = [];
  for (const name of names) {
    if (!/^cli-.*\.log$/i.test(name)) continue;
    const path = join(root, name);
    try {
      const s = await stat(path);
      if (now - s.mtimeMs <= AGY_ACTIVE_MS) candidates.push({ path, mtime: s.mtimeMs });
    } catch {
      /* 略過競態刪除/壞檔 */
    }
  }
  const byCwd = new Map<string, SessionStatus>();
  for (const c of candidates.sort((a, b) => b.mtime - a.mtime)) {
    try {
      const parsed = parseAgyLog(await readFile(c.path, 'utf8'), c.mtime);
      if (!parsed) continue;
      const key = parsed.cwd.toLowerCase();
      if (!byCwd.has(key)) byCwd.set(key, parsed);
    } catch {
      /* 單檔失敗不影響其他工作區 */
    }
  }
  return [...byCwd.values()];
}
