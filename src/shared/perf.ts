// perf 時間戳埋點 helper（供 REQ-PERF 量測）。main 與 renderer 共用。
// 用 global performance.now()（Node 18+ / Chromium 皆有），mark/measure + p95 工具。

const marks = new Map<string, number>();
const measures = new Map<string, number[]>();

export function nowMs(): number {
  return performance.now();
}

/** 記一個時間戳標記。 */
export function mark(name: string): void {
  marks.set(name, nowMs());
}

/**
 * 量 startMark 到 endMark（省略 endMark 則用「現在」）的毫秒差，
 * 並把樣本累積到 measure 名下供 p95 計算。回傳本次差值。
 */
export function measure(name: string, startMark: string, endMark?: string): number {
  const start = marks.get(startMark);
  if (start === undefined) throw new Error(`perf: 缺少起始 mark "${startMark}"`);
  const end = endMark === undefined ? nowMs() : marks.get(endMark);
  if (end === undefined) throw new Error(`perf: 缺少結束 mark "${endMark}"`);
  const dur = end - start;
  const arr = measures.get(name) ?? [];
  arr.push(dur);
  measures.set(name, arr);
  return dur;
}

/** 直接記一筆已知毫秒樣本（不經 mark）。 */
export function record(name: string, durationMs: number): void {
  const arr = measures.get(name) ?? [];
  arr.push(durationMs);
  measures.set(name, arr);
}

/** 取某 measure 的所有樣本副本。 */
export function getMeasures(name: string): number[] {
  return [...(measures.get(name) ?? [])];
}

/** 取樣本 p95（最近鄰插值，樣本空回 NaN）。 */
export function p95(samples: number[]): number {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx))];
}

/** 清空所有 mark / measure（測試用）。 */
export function clearPerf(): void {
  marks.clear();
  measures.clear();
}
