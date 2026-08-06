// Codex 對話軸資料源：只接受互動式 TUI rollout 的 event_msg/user_message，
// 排除 response_item 裡由系統注入的 user context、subagent 與 exec session。

import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ClaudeTranscript, ConversationRailNode } from '../../shared/types';
import { codexSessionsRoot } from './codexRollout';

const PREVIEW_MAX = 120;

interface SessionMeta {
  id: string;
  cwd: string;
  source: string;
  originator: string;
}

interface CacheEntry {
  offset: number;
  nextIndex: number;
  nodes: ConversationRailNode[];
}

const cache = new Map<string, CacheEntry>();
const sessionPathById = new Map<string, string>();
export const MAX_CODEX_CONVERSATION_CANDIDATES = 12;
export const MAX_CODEX_CONVERSATION_NODES = 220;

function normPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function cleanPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX);
}

export function parseCodexSessionMeta(line: string): SessionMeta | null {
  try {
    const entry = JSON.parse(line) as {
      type?: unknown;
      payload?: { id?: unknown; cwd?: unknown; source?: unknown; originator?: unknown };
    };
    const p = entry.payload;
    if (
      entry.type !== 'session_meta' ||
      typeof p?.id !== 'string' ||
      typeof p.cwd !== 'string' ||
      p.source !== 'cli' ||
      p.originator !== 'codex-tui'
    ) {
      return null;
    }
    return { id: p.id, cwd: p.cwd, source: p.source, originator: p.originator };
  } catch {
    return null;
  }
}

export function parseCodexUserMessage(line: string): string | null {
  try {
    const entry = JSON.parse(line) as { type?: unknown; payload?: { type?: unknown; message?: unknown } };
    if (entry.type !== 'event_msg' || entry.payload?.type !== 'user_message') return null;
    if (typeof entry.payload.message !== 'string') return null;
    const text = entry.payload.message.trim();
    return text || null;
  } catch {
    return null;
  }
}

function recentDayDirs(root: string, now: number): string[] {
  const dirs: string[] = [];
  for (let offset = 0; offset < 2; offset += 1) {
    const date = new Date(now - offset * 24 * 60 * 60 * 1000);
    dirs.push(
      join(
        root,
        String(date.getFullYear()),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ),
    );
  }
  return dirs;
}

async function readFirstLine(path: string): Promise<string> {
  const fh = await open(path, 'r');
  try {
    let text = '';
    let position = 0;
    while (position < 512 * 1024) {
      const buffer = Buffer.alloc(16 * 1024);
      const { bytesRead } = await fh.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      text += buffer.toString('utf8', 0, bytesRead);
      const newline = text.indexOf('\n');
      if (newline >= 0) return text.slice(0, newline);
      position += bytesRead;
    }
    return text;
  } finally {
    await fh.close();
  }
}

async function readCompleteLines(path: string, start: number, end: number): Promise<{ lines: string[]; consumed: number }> {
  if (end <= start) return { lines: [], consumed: 0 };
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { start, end: end - 1 });
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const buffer = Buffer.concat(chunks);
  const newline = buffer.lastIndexOf(0x0a);
  if (newline < 0) return { lines: [], consumed: 0 };
  return {
    lines: buffer.subarray(0, newline + 1).toString('utf8').split('\n').filter(Boolean),
    consumed: newline + 1,
  };
}

export function clearCodexConversationCache(): void {
  cache.clear();
  sessionPathById.clear();
}

interface Candidate {
  path: string;
  size: number;
  mtimeMs: number;
  meta: SessionMeta;
}

async function readCandidate(candidate: Candidate): Promise<ClaudeTranscript> {
  sessionPathById.set(candidate.meta.id, candidate.path);
  const previous = cache.get(candidate.path);
  const reusable = previous && previous.offset <= candidate.size;
  const start = reusable ? previous.offset : 0;
  let nextIndex = reusable ? previous.nextIndex : 0;
  let nodes = reusable ? [...previous.nodes] : [];
  const { lines, consumed } = await readCompleteLines(candidate.path, start, candidate.size);
  for (const line of lines) {
    const matchText = parseCodexUserMessage(line);
    if (!matchText) continue;
    nodes.push({ index: nextIndex, preview: cleanPreview(matchText), matchText });
    nextIndex += 1;
  }
  if (nodes.length > MAX_CODEX_CONVERSATION_NODES) {
    nodes = nodes.slice(-MAX_CODEX_CONVERSATION_NODES);
  }
  cache.set(candidate.path, { offset: start + consumed, nextIndex, nodes: [...nodes] });
  return { sessionId: candidate.meta.id, nodes };
}

/**
 * 同 cwd 讀取近期互動式 TUI rollout 候選。cwd 不是 session 身分，故不在 main 猜最新一個；
 * renderer 必須再用目前 terminal 的 scrollback 唯一反證，否則 fail-closed。
 */
export async function readCodexConversations(
  cwd: string,
  root: string = codexSessionsRoot(homedir()),
  now: number = Date.now(),
): Promise<ClaudeTranscript[]> {
  const candidates: Candidate[] = [];
  for (const dir of recentDayDirs(root, now)) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        const meta = parseCodexSessionMeta(await readFirstLine(path));
        if (meta && normPath(meta.cwd) === normPath(cwd)) {
          candidates.push({ path, size: info.size, mtimeMs: info.mtimeMs, meta });
        }
      } catch {
        // 掃描期間被刪除或壞檔：略過。
      }
    }
  }
  const selected = candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_CODEX_CONVERSATION_CANDIDATES);
  return Promise.all(selected.map(readCandidate));
}

/** 已由 renderer 畫面證據綁定後，沿用確切 session path；不因 12 小時或跨日而失效。 */
export async function readCodexConversationById(cwd: string, sessionId: string): Promise<ClaudeTranscript | null> {
  const path = sessionPathById.get(sessionId);
  if (!path) return null;
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    const meta = parseCodexSessionMeta(await readFirstLine(path));
    if (!meta || meta.id !== sessionId || normPath(meta.cwd) !== normPath(cwd)) return null;
    return readCandidate({ path, size: info.size, mtimeMs: info.mtimeMs, meta });
  } catch {
    return null;
  }
}

/** 相容既有內部呼叫：只在候選恰一個時才可視為已綁定。 */
export async function readCodexConversation(
  cwd: string,
  root: string = codexSessionsRoot(homedir()),
  now: number = Date.now(),
): Promise<ClaudeTranscript | null> {
  const candidates = await readCodexConversations(cwd, root, now);
  return candidates.length === 1 ? candidates[0] : null;
}
