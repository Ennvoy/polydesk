import { describe, it, expect } from 'vitest';
import { computeGitGraph, type GitGraphInput } from './gitGraph';

const nodeLanes = (commits: GitGraphInput[]): number[] =>
  computeGitGraph(commits).rows.map((r) => r.commitLane);

describe('computeGitGraph', () => {
  it('線性歷史：全部落在 lane 0、單欄', () => {
    const g = computeGitGraph([
      { hash: 'A', parents: ['B'] },
      { hash: 'B', parents: ['C'] },
      { hash: 'C', parents: [] },
    ]);
    expect(g.rows.map((r) => r.commitLane)).toEqual([0, 0, 0]);
    expect(g.maxLanes).toBe(1);
    // 每列除最後 root 外都有一條直下 out；中間列有 in。
    expect(g.rows[2].segments.some((s) => s.kind === 'out')).toBe(false); // root 無 parent
    expect(g.rows[0].segments.some((s) => s.kind === 'out')).toBe(true);
  });

  it('分岔＋合併（diamond）：merge commit 開第二 lane，最後收斂回 lane 0', () => {
    // 順序（新→舊）：M 合併 A、B；A、B 各自 parent = Base
    const g = computeGitGraph([
      { hash: 'M', parents: ['A', 'B'] },
      { hash: 'A', parents: ['Base'] },
      { hash: 'B', parents: ['Base'] },
      { hash: 'Base', parents: [] },
    ]);
    const lanes = g.rows.map((r) => r.commitLane);
    expect(lanes[0]).toBe(0); // M
    expect(lanes[1]).toBe(0); // A 續在 M 的 lane
    expect(lanes[2]).toBe(1); // B 在分岔出的第二 lane
    expect(lanes[3]).toBe(0); // Base 收斂回 lane 0
    expect(g.maxLanes).toBe(2);
    // M 有兩條 out（分岔到 lane0 與 lane1）
    expect(g.rows[0].segments.filter((s) => s.kind === 'out').map((s) => s.to).sort()).toEqual([0, 1]);
    // Base 收斂：有來自 lane1 的 in（→ lane0）
    expect(g.rows[3].segments.some((s) => s.kind === 'in' && s.from === 1 && s.to === 0)).toBe(true);
    // A 那列 B 的 lane 直通
    expect(g.rows[1].segments.some((s) => s.kind === 'through' && s.from === 1)).toBe(true);
  });

  it('兩個獨立 root：各自配獨立 lane', () => {
    const g = computeGitGraph([
      { hash: 'X', parents: [] },
      { hash: 'Y', parents: [] },
    ]);
    // X 用 lane0 即關閉 → Y 可重用 lane0（trim 後）
    expect(nodeLanes([
      { hash: 'X', parents: [] },
      { hash: 'Y', parents: [] },
    ])).toEqual([0, 0]);
    expect(g.maxLanes).toBe(1);
  });

  it('octopus 合併（3 parents）：開到 3 條 lane、3 條 out', () => {
    const g = computeGitGraph([
      { hash: 'O', parents: ['P1', 'P2', 'P3'] },
      { hash: 'P1', parents: [] },
      { hash: 'P2', parents: [] },
      { hash: 'P3', parents: [] },
    ]);
    const outs = g.rows[0].segments.filter((s) => s.kind === 'out');
    expect(outs.map((s) => s.to).sort()).toEqual([0, 1, 2]);
    expect(g.maxLanes).toBeGreaterThanOrEqual(3);
  });

  it('每個 in 線段都指向該列節點 lane；每個 out 都從節點 lane 出發', () => {
    const g = computeGitGraph([
      { hash: 'M', parents: ['A', 'B'] },
      { hash: 'A', parents: ['Base'] },
      { hash: 'B', parents: ['Base'] },
      { hash: 'Base', parents: [] },
    ]);
    for (const row of g.rows) {
      for (const s of row.segments) {
        if (s.kind === 'in') expect(s.to).toBe(row.commitLane);
        if (s.kind === 'out') expect(s.from).toBe(row.commitLane);
      }
    }
  });

  it('空輸入：rows 空、maxLanes 至少 1（不除以零）', () => {
    const g = computeGitGraph([]);
    expect(g.rows).toEqual([]);
    expect(g.maxLanes).toBe(1);
  });
});
