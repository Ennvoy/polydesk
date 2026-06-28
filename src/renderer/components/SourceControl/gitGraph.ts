// Git commit 線圖 lane 配置（純函式，F-7 歷史視覺化）。
// 輸入：git log 順序（新→舊）的 commit + parents；輸出：每列節點 lane、顏色、與該列要畫的線段。
//
// 演算法（swimlane）：維護 lanes[i] = 該 lane 目前「routing 中、預期下一個出現」的 commit hash。
//  每處理一個 commit：
//   1. 節點欄 = 指向它的第一個 lane（無＝新 tip 配空 lane）。
//   2. 指向它的所有 lane 收斂成 merge-in 線（'in'）。
//   3. 該節點 lane 改 route 到第一個 parent（直下 'out'）；額外 parent（merge）配空 lane（分岔 'out'）。
//   4. 未涉入的既有 lane 整列直通（'through'）。
//  色彩 per-lane 穩定、分岔開新色。純函式 → node 可單元測試（真實演算法、非 mock 被測邏輯）。

export interface GitGraphInput {
  hash: string;
  parents: string[];
}

export type SegmentKind = 'in' | 'out' | 'through';

export interface GitGraphSegment {
  /** in/through：上緣 lane；out：節點 lane。 */
  from: number;
  /** in：節點 lane；out/through：下緣 lane。 */
  to: number;
  color: number;
  kind: SegmentKind;
}

export interface GitGraphRow {
  hash: string;
  commitLane: number;
  color: number;
  segments: GitGraphSegment[];
  /** 本列觸及的最大 lane+1（節點 + 所有線段）。 */
  laneCount: number;
}

export interface GitGraph {
  rows: GitGraphRow[];
  /** 全圖最大 lane 數（決定 SVG 欄寬）。 */
  maxLanes: number;
}

export function computeGitGraph(commits: readonly GitGraphInput[]): GitGraph {
  const lanes: (string | null)[] = []; // 各 lane 預期下一個 commit hash
  const colors: number[] = []; // 與 lanes 平行的色彩索引
  let nextColor = 0;
  const rows: GitGraphRow[] = [];

  const firstFree = (): number => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };

  for (const commit of commits) {
    // 1. 節點欄：指向此 commit 的第一個 lane；無則配空 lane（tip）。
    let commitLane = lanes.indexOf(commit.hash);
    let color: number;
    if (commitLane === -1) {
      commitLane = firstFree();
      color = nextColor++;
    } else {
      color = colors[commitLane];
    }
    if (commitLane >= lanes.length) lanes[commitLane] = null; // 擴張涵蓋新 lane
    colors[commitLane] = color;

    const entering = lanes.slice();
    const enteringColors = colors.slice();
    const segments: GitGraphSegment[] = [];

    // 2. merge-in：所有指向此 commit 的 lane 收斂進節點。
    for (let i = 0; i < entering.length; i++) {
      if (entering[i] === commit.hash) {
        segments.push({ from: i, to: commitLane, color: enteringColors[i], kind: 'in' });
      }
    }

    // 3. 清掉所有指向此 commit 的 lane（commitLane 稍後由第一個 parent 接手）。
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) lanes[i] = null;
    }

    // 4. parents → 出線。
    if (commit.parents.length > 0) {
      lanes[commitLane] = commit.parents[0];
      colors[commitLane] = color;
      segments.push({ from: commitLane, to: commitLane, color, kind: 'out' });
      for (let p = 1; p < commit.parents.length; p++) {
        const ph = commit.parents[p];
        let pl = lanes.indexOf(ph);
        if (pl === -1) {
          pl = firstFree();
          if (pl >= lanes.length) lanes[pl] = null;
          lanes[pl] = ph;
          colors[pl] = nextColor++;
        }
        segments.push({ from: commitLane, to: pl, color: colors[pl], kind: 'out' });
      }
    } else {
      lanes[commitLane] = null; // root：lane 關閉
    }

    // 5. 直通：未涉入此 commit 的既有 lane 整列穿過。
    for (let i = 0; i < entering.length; i++) {
      if (entering[i] !== null && entering[i] !== commit.hash) {
        segments.push({ from: i, to: i, color: enteringColors[i], kind: 'through' });
      }
    }

    // 6. 修剪尾端空 lane（色彩同步）。
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }

    let laneCount = commitLane + 1;
    for (const s of segments) laneCount = Math.max(laneCount, s.from + 1, s.to + 1);
    rows.push({ hash: commit.hash, commitLane, color, segments, laneCount });
  }

  const maxLanes = rows.reduce((m, r) => Math.max(m, r.laneCount), 1);
  return { rows, maxLanes };
}
