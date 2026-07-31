import { describe, expect, it } from 'vitest';
import {
  activeTerminalNavigationIndex,
  adjacentTerminalNavigationIndex,
  buildTerminalNavigationNodes,
} from './terminalNavigation';

describe('terminalNavigation', () => {
  it('只把非空白的邏輯行做成節點，略過換行延續行', () => {
    const nodes = buildTerminalNavigationNodes([
      { line: 0, text: '第一段', isWrapped: false },
      { line: 1, text: '  延續內容  ', isWrapped: true },
      { line: 2, text: '   ', isWrapped: false },
      { line: 3, text: '第二    段', isWrapped: false },
    ]);

    expect(nodes.map(({ line, preview }) => ({ line, preview }))).toEqual([
      { line: 0, preview: '第一段' },
      { line: 3, preview: '第二 段' },
    ]);
    expect(nodes.every((node) => node.width >= 5 && node.width <= 18)).toBe(true);
  });

  it('大量輸出會等距壓縮並保留第一與最後節點', () => {
    const lines = Array.from({ length: 20 }, (_, line) => ({ line, text: `line ${line}`, isWrapped: false }));
    const nodes = buildTerminalNavigationNodes(lines, 5);

    expect(nodes).toHaveLength(5);
    expect(nodes[0].line).toBe(0);
    expect(nodes.at(-1)?.line).toBe(19);
    expect(nodes.map((node) => node.line)).toEqual([...nodes.map((node) => node.line)].sort((a, b) => a - b));
  });

  it('依 viewport 找目前節點與嚴格相鄰的前後節點', () => {
    const nodes = buildTerminalNavigationNodes([
      { line: 2, text: 'a', isWrapped: false },
      { line: 8, text: 'b', isWrapped: false },
      { line: 15, text: 'c', isWrapped: false },
    ]);

    expect(activeTerminalNavigationIndex(nodes, 0)).toBe(0);
    expect(activeTerminalNavigationIndex(nodes, 8)).toBe(1);
    expect(activeTerminalNavigationIndex(nodes, 99)).toBe(2);
    expect(adjacentTerminalNavigationIndex(nodes, 8, -1)).toBe(0);
    expect(adjacentTerminalNavigationIndex(nodes, 8, 1)).toBe(2);
    expect(adjacentTerminalNavigationIndex(nodes, 0, -1)).toBe(0);
    expect(adjacentTerminalNavigationIndex(nodes, 99, 1)).toBe(2);
  });
});
