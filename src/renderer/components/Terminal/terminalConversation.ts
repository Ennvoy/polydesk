import type { ConversationRailNode, ConversationRailSession } from '../../../shared/types';
import { MAX_TERMINAL_NAVIGATION_NODES, type TerminalNavigationNode } from './terminalNavigation';

export interface TerminalBufferRow {
  line: number;
  text: string;
  isWrapped: boolean;
}

export interface LogicalTerminalLine {
  line: number;
  text: string;
}

/** xterm 的 wrapped continuation 還原成一則 logical line，保留起始絕對行號。 */
export function buildLogicalTerminalLines(rows: readonly TerminalBufferRow[]): LogicalTerminalLine[] {
  const logical: LogicalTerminalLine[] = [];
  for (const row of rows) {
    if (row.isWrapped && logical.length > 0) {
      logical[logical.length - 1].text += row.text;
    } else {
      logical.push({ line: row.line, text: row.text });
    }
  }
  return logical;
}

function normalizePrompt(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePromptLine(text: string): string | null {
  const match = text.replace(/\u00a0/g, ' ').match(/^[\s│┃┆╎┊┋]*[›❯]\s*(.*)$/);
  return match ? normalizePrompt(match[1]) : null;
}

/**
 * Codex 沒有跳到指定回合的 API；只有 rollout 原文在目前 scrollback 中恰好唯一命中時才建立節點。
 * 重複、截斷或模糊匹配一律略過，避免點擊跳到模型引用或另一個 terminal 的同文。
 */
export function matchCodexConversationNodes(
  prompts: readonly ConversationRailNode[],
  lines: readonly LogicalTerminalLine[],
  maxNodes = MAX_TERMINAL_NAVIGATION_NODES,
): TerminalNavigationNode[] {
  if (maxNodes <= 0) return [];
  return matchCodexPrompts(prompts, buildLineIndex(lines), maxNodes);
}

function buildLineIndex(lines: readonly LogicalTerminalLine[]): Map<string, number[]> {
  const lineIndex = new Map<string, number[]>();
  for (const line of lines) {
    const normalized = normalizePromptLine(line.text);
    if (!normalized) continue;
    const positions = lineIndex.get(normalized);
    if (positions) positions.push(line.line);
    else lineIndex.set(normalized, [line.line]);
  }
  return lineIndex;
}

function matchCodexPrompts(
  prompts: readonly ConversationRailNode[],
  lineIndex: ReadonlyMap<string, number[]>,
  maxNodes: number,
): TerminalNavigationNode[] {
  const matched: TerminalNavigationNode[] = [];
  let afterLine = -1;
  for (const prompt of prompts) {
    const target = normalizePrompt(prompt.matchText ?? '');
    if (!target) continue;
    const positions = lineIndex.get(target) ?? [];
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (positions[middle] <= afterLine) low = middle + 1;
      else high = middle;
    }
    // afterLine 後仍有多個同文時無法知道哪一個是 prompt，保持 fail-closed。
    if (positions.length - low !== 1) continue;
    const line = positions[low];
    matched.push({ line, preview: prompt.preview, width: 16 });
    afterLine = line;
  }
  return matched.length > maxNodes ? matched.slice(-maxNodes) : matched;
}

/**
 * cwd 只用來找候選，不是 session 身分。恰好一個 session 能命中目前 xterm 的 prompt 行才可綁定；
 * 外部／其他 terminal rollout 也有任何畫面命中時一律維持空白，不以分數猜 session。
 */
export function selectCodexConversationSession(
  sessions: readonly ConversationRailSession[],
  lines: readonly LogicalTerminalLine[],
): { sessionId: string; nodes: TerminalNavigationNode[] } | null {
  const lineIndex = buildLineIndex(lines);
  const matched = sessions
    .map((session) => ({
      sessionId: session.sessionId,
      nodes: matchCodexPrompts(session.nodes, lineIndex, MAX_TERMINAL_NAVIGATION_NODES),
    }))
    .filter((session) => session.nodes.length > 0);
  return matched.length === 1 ? matched[0] : null;
}
