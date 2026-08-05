// Claude Code 一啟動就切 alternate screen（送 ?1049h 不退出）自繪整個畫面，xterm 的 alt buffer 沒有
// scrollback → 內容導覽軌的條件（buffer 行數 > 可視列數）在 claude 面板恆為 false，節點永遠不畫。
// 因此 claude 面板改用它自己寫的 session transcript 當資料源，讓軸的節點對齊「訊息」而非「終端機行」。
//
// 資料源：~/.claude/projects/<slug>/<sessionId>.jsonl（append-only，每行一個 JSON）。
// 綁定方式刻意零侵入——不改使用者的啟動指令，靠「工作區 cwd → slug 目錄 → mtime 最新的 jsonl」定位，
// 再以檔內 cwd 欄位覆核，避免 slug 轉換在邊界字元上失準時對到別的專案。

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ClaudeTranscript, ClaudeTranscriptNode } from '../../shared/types';

/** transcript 單則訊息的中間表示（role + 摘要），promptsFromEnd 由 buildTranscriptNodes 補。 */
interface RawEntry {
  role: 'user' | 'assistant';
  preview: string;
}

const PREVIEW_MAX = 120;

/**
 * cwd → claude 的專案目錄名：非英數字元一律換成 `-`（claude 自己的規則）。
 * 例：C:\Users\ennvoy.lin\Documents\我的終端機 → C--Users-ennvoy-lin-Documents------
 */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** 摘要清理：剝掉 system-reminder 與 XML-ish 標籤，壓成單行並截斷。 */
function cleanPreview(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]{0,60}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX);
}

/** 取 content 陣列（或純字串）中的 text 片段；非陣列非字串回空。 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: string; text: string } =>
      typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text',
    )
    .map((part) => part.text ?? '')
    .join(' ');
}

/**
 * 一行 jsonl → 訊息，非訊息行回 null。排除的是「不是對話的東西」：
 * sidechain（subagent）、isMeta（圖片來源等系統補註）、tool_result 回填、只有 thinking/tool_use 的
 * assistant 回合，以及 slash 指令的本地 stdout。
 */
export function parseTranscriptLine(line: string): RawEntry | null {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null; // 尾端半行或壞行：略過，不讓整條軸消失
  }
  if (entry.isSidechain === true || entry.isMeta === true) return null;
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;

  if (entry.type === 'user') {
    if (Array.isArray(content) && content.some((part) => (part as { type?: unknown })?.type === 'tool_result')) {
      return null;
    }
    const raw = textOf(content);
    if (raw.startsWith('<local-command-stdout>')) return null;
    const preview = cleanPreview(raw);
    return preview ? { role: 'user', preview } : null;
  }
  if (entry.type === 'assistant') {
    const preview = cleanPreview(textOf(content)); // thinking / tool_use 不含 text → 不建節點
    return preview ? { role: 'assistant', preview } : null;
  }
  return null;
}

/**
 * 補上 promptsFromEnd：從最新往回數，這則之後（含自己，user 才算）還有幾個 user prompt。
 * 點擊節點時 renderer 送 Ctrl+O 進 claude 的 transcript 檢視（預設停在最新），再送這麼多次 `{`
 * 往回跳 user prompt——相對最新的偏移是唯一算得準的定位，絕對行號在 alt screen 拿不到。
 */
export function buildTranscriptNodes(entries: readonly RawEntry[]): ClaudeTranscriptNode[] {
  // 先摺疊同一回合的連續發言（claude 一個回合常在工具呼叫之間講很多次話）：定位只能跳到 user
  // prompt，同回合的每一則 assistant 都會跳到同一處，展開成多個節點只是假的可點性。
  const turns: RawEntry[] = [];
  for (const entry of entries) {
    if (turns[turns.length - 1]?.role === entry.role) continue;
    turns.push(entry);
  }

  const totalPrompts = turns.filter((entry) => entry.role === 'user').length;
  let seenPrompts = 0;
  return turns.map((entry, index) => {
    if (entry.role === 'user') seenPrompts += 1;
    return {
      index,
      role: entry.role,
      preview: entry.preview,
      promptsFromEnd: Math.max(0, totalPrompts - seenPrompts),
    };
  });
}

/** 增量讀取狀態：jsonl 是 append-only，只有檔案沒被換掉才能沿用既有 entries。 */
interface CacheEntry {
  path: string;
  offset: number;
  entries: RawEntry[];
}
const cache = new Map<string, CacheEntry>();

/** 測試與工作區關閉用：丟掉某 cwd（或全部）的增量快取。 */
export function clearTranscriptCache(cwd?: string): void {
  if (cwd === undefined) cache.clear();
  else cache.delete(cwd);
}

/** slug 目錄下 mtime 最新的 *.jsonl；無檔或無目錄回 null。 */
async function latestSessionFile(dir: string): Promise<{ path: string; size: number; sessionId: string } | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null; // 這個專案沒跑過 claude
  }
  let best: { path: string; size: number; sessionId: string; mtimeMs: number } | null = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (!best || info.mtimeMs > best.mtimeMs) {
        best = { path, size: info.size, sessionId: name.slice(0, -'.jsonl'.length), mtimeMs: info.mtimeMs };
      }
    } catch {
      // 掃描期間被刪：略過
    }
  }
  return best ? { path: best.path, size: best.size, sessionId: best.sessionId } : null;
}

/** 讀 [start, end) 位元組；回傳完整行（截到最後一個 \n）與實際消費的位元組數。 */
async function readAppendedLines(path: string, start: number, end: number): Promise<{ lines: string[]; consumed: number }> {
  if (end <= start) return { lines: [], consumed: 0 };
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { start, end: end - 1 });
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const buf = Buffer.concat(chunks);
  const lastNewline = buf.lastIndexOf(0x0a);
  if (lastNewline < 0) return { lines: [], consumed: 0 }; // 還沒寫完一整行，下次再讀
  const complete = buf.subarray(0, lastNewline + 1).toString('utf8');
  return { lines: complete.split('\n').filter((line) => line.length > 0), consumed: lastNewline + 1 };
}

/**
 * 讀某工作區當前 claude session 的對話節點。找不到目錄/檔案回 null（renderer 據此保持原本的行導覽軌）。
 * 檔案變小或換檔視為新 session，整份重讀；否則只讀新增段落，長 session 也不會每次重解析數 MB。
 */
export async function readClaudeTranscript(cwd: string, home: string = homedir()): Promise<ClaudeTranscript | null> {
  const dir = join(home, '.claude', 'projects', claudeProjectSlug(cwd));
  const file = await latestSessionFile(dir);
  if (!file) return null;

  const cached = cache.get(cwd);
  const reusable = cached && cached.path === file.path && cached.offset <= file.size;
  const start = reusable ? cached.offset : 0;
  const entries = reusable ? cached.entries : [];

  const { lines, consumed } = await readAppendedLines(file.path, start, file.size);
  for (const line of lines) {
    const entry = parseTranscriptLine(line);
    if (entry) entries.push(entry);
  }
  cache.set(cwd, { path: file.path, offset: start + consumed, entries });

  return { sessionId: file.sessionId, nodes: buildTranscriptNodes(entries) };
}
