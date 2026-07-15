// PE-4：切工作區自動 fetch 的冷卻判定（手動 ⟳ 觸發不走冷卻）。
// 被擋的觸發不刷新時計——否則高頻觸發會把放行時間永遠往後推、再也 fetch 不到。

export function shouldAutoFetch(
  lastAt: Map<string, number>,
  key: string,
  now: number,
  cooldownMs: number,
): boolean {
  const prev = lastAt.get(key);
  if (prev !== undefined && now - prev < cooldownMs) return false;
  lastAt.set(key, now);
  return true;
}
