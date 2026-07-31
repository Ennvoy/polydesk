// 終端機內容導覽軌的純函式：從 xterm buffer 的邏輯行建立可跳轉節點，並在大量輸出時
// 等距壓縮到固定上限，避免每次串流輸出都產生數千個 DOM button。

export interface TerminalNavigationLine {
  line: number;
  text: string;
  isWrapped: boolean;
}
export interface TerminalNavigationNode {
  line: number;
  preview: string;
  width: number;
}

export const MAX_TERMINAL_NAVIGATION_NODES = 220;

function cleanPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function nodeWidth(preview: string): number {
  return Math.max(5, Math.min(18, 5 + Math.round(Math.sqrt(preview.length) * 1.7)));
}

/**
 * 每個非空白、非 wrapped continuation 的邏輯行建立一個節點。超過上限時保留頭尾，
 * 中間依原始順序等距抽樣；這使長時間 terminal session 的 rail 仍保持固定渲染成本。
 */
export function buildTerminalNavigationNodes(
  lines: readonly TerminalNavigationLine[],
  maxNodes = MAX_TERMINAL_NAVIGATION_NODES,
): TerminalNavigationNode[] {
  if (maxNodes <= 0) return [];
  const candidates = lines.flatMap((line) => {
    if (line.isWrapped) return [];
    const preview = cleanPreview(line.text);
    return preview ? [{ line: line.line, preview, width: nodeWidth(preview) }] : [];
  });
  if (candidates.length <= maxNodes) return candidates;
  if (maxNodes === 1) return [candidates[candidates.length - 1]];

  const sampled: TerminalNavigationNode[] = [];
  const last = candidates.length - 1;
  for (let i = 0; i < maxNodes; i++) {
    const index = Math.round((i * last) / (maxNodes - 1));
    const candidate = candidates[index];
    if (sampled[sampled.length - 1]?.line !== candidate.line) sampled.push(candidate);
  }
  return sampled;
}

/** 目前 viewport 對應的節點：取不超過 viewport 首行的最後一個，頂端則取第一個。 */
export function activeTerminalNavigationIndex(nodes: readonly TerminalNavigationNode[], viewportLine: number): number {
  if (nodes.length === 0) return -1;
  let low = 0;
  let high = nodes.length - 1;
  let answer = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (nodes[middle].line <= viewportLine) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

/** Alt+方向鍵尋找嚴格位於 viewport 前／後的節點；抵達邊界時停在首尾。 */
export function adjacentTerminalNavigationIndex(
  nodes: readonly TerminalNavigationNode[],
  viewportLine: number,
  direction: -1 | 1,
): number {
  if (nodes.length === 0) return -1;
  if (direction < 0) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].line < viewportLine) return i;
    }
    return 0;
  }
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].line > viewportLine) return i;
  }
  return nodes.length - 1;
}
