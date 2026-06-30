// codexRollout 測試：解析純函式（task 邊界判定、半行容錯）+ reader（真實 temp rollout 掃描/歸戶/活躍窗）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRolloutTail, parseSessionMetaCwd, readCodexSessions } from './codexRollout';

function metaLine(cwd: string): string {
  return JSON.stringify({ timestamp: '2026-06-30T09:05:35.875Z', type: 'session_meta', payload: { id: 'sid', cwd, cli_version: '0.133.0' } });
}
function ev(type: string, ts: string, evType = false): string {
  return JSON.stringify({ timestamp: ts, type: evType ? 'event_msg' : 'response_item', payload: { type } });
}

describe('codexRollout 解析純函式', () => {
  it('parseSessionMetaCwd 取 payload.cwd；壞檔/缺欄回 null', () => {
    expect(parseSessionMetaCwd(metaLine('C:\\proj\\a'))).toBe('C:\\proj\\a');
    expect(parseSessionMetaCwd('not json')).toBeNull();
    expect(parseSessionMetaCwd(JSON.stringify({ payload: {} }))).toBeNull();
  });

  it('最後 task_complete → done（帶該事件 ts）', () => {
    const tail = [
      ev('task_started', '2026-06-30T09:05:39.271Z', true),
      ev('function_call', '2026-06-30T09:05:45.000Z'),
      ev('task_complete', '2026-06-30T09:06:00.000Z', true),
    ].join('\n');
    const r = parseRolloutTail(tail);
    expect(r?.state).toBe('done');
    expect(r?.ts).toBe(Date.parse('2026-06-30T09:06:00.000Z'));
  });

  it('最後 task_started（新 turn 進行中）→ working，即使前面有舊 task_complete', () => {
    const tail = [
      ev('task_complete', '2026-06-30T09:00:00.000Z', true),
      ev('task_started', '2026-06-30T09:05:00.000Z', true),
      ev('function_call', '2026-06-30T09:05:10.000Z'),
    ].join('\n');
    expect(parseRolloutTail(tail)?.state).toBe('working');
  });

  it('尾端只有活動、沒掃到 task 邊界 → 保守 working', () => {
    const tail = [ev('function_call', '2026-06-30T09:05:10.000Z'), ev('exec_command_end', '2026-06-30T09:05:12.000Z', true)].join('\n');
    expect(parseRolloutTail(tail)?.state).toBe('working');
  });

  it('半行（tail 從中間切斷）skip 不崩；空 → null', () => {
    const tail = '{"broken jso\n' + ev('task_complete', '2026-06-30T09:06:00.000Z', true);
    expect(parseRolloutTail(tail)?.state).toBe('done');
    expect(parseRolloutTail('')).toBeNull();
    expect(parseRolloutTail('\n  \n')).toBeNull();
  });
});

describe('readCodexSessions（真實檔案掃描）', () => {
  let root: string;
  const now = Date.now();
  function dayDir(): string {
    const d = new Date(now);
    return join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  }
  function writeRollout(name: string, cwd: string, lastEvent: string): string {
    const dir = dayDir();
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, metaLine(cwd) + '\n' + ev('task_started', '2026-06-30T09:05:39.271Z', true) + '\n' + lastEvent + '\n');
    return p;
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-codex-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('掃近期 rollout → codex SessionStatus（cwd 歸戶 + 狀態解析）', async () => {
    writeRollout('rollout-2026-06-30T09-00-00-019f17c6-b202-79a0-a1fa-988cbfd9a0af.jsonl', 'C:/proj/a', ev('task_complete', '2026-06-30T09:06:00.000Z', true));
    const out = await readCodexSessions(root, now);
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe('codex');
    expect(out[0].cwd).toBe('C:/proj/a');
    expect(out[0].state).toBe('done');
    expect(out[0].sessionId).toBe('019f17c6-b202-79a0-a1fa-988cbfd9a0af');
  });

  it('mtime 超過活躍窗（>10min）的 rollout 不回報', async () => {
    const p = writeRollout('rollout-2026-06-30T08-00-00-019f17c6-b202-79a0-a1fa-000000000000.jsonl', 'C:/proj/old', ev('task_complete', '2026-06-30T08:00:00.000Z', true));
    const oldMs = (now - 20 * 60 * 1000) / 1000; // 20 分鐘前
    utimesSync(p, oldMs, oldMs);
    const out = await readCodexSessions(root, now);
    expect(out).toHaveLength(0);
  });

  it('同 cwd 多 rollout → 取 mtime 最新那個', async () => {
    const older = writeRollout('rollout-2026-06-30T09-00-00-019f17c6-0000-79a0-a1fa-000000000001.jsonl', 'C:/proj/x', ev('task_complete', '2026-06-30T09:00:00.000Z', true));
    utimesSync(older, (now - 5 * 60 * 1000) / 1000, (now - 5 * 60 * 1000) / 1000); // 5 分鐘前
    writeRollout('rollout-2026-06-30T09-10-00-019f17c6-0000-79a0-a1fa-000000000002.jsonl', 'C:/proj/x', ev('task_started', '2026-06-30T09:10:00.000Z', true)); // 現在（最新）= working
    const out = await readCodexSessions(root, now);
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('working'); // 取最新那個
  });
});
