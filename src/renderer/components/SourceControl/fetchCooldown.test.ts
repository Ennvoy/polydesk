// PE-4：切工作區自動 fetch 的冷卻判定（純函式）。手動 ⟳ 觸發不走冷卻，不在此範圍。

import { describe, it, expect } from 'vitest';
import { shouldAutoFetch } from './fetchCooldown';

const CD = 60_000;

describe('shouldAutoFetch（同 key 冷卻）', () => {
  it('首次觸發 → 放行並記時', () => {
    const m = new Map<string, number>();
    expect(shouldAutoFetch(m, 'ws1', 1_000, CD)).toBe(true);
    expect(m.get('ws1')).toBe(1_000);
  });

  it('冷卻期內 → 擋下，且不重置時計（連續觸發不會永遠順延）', () => {
    const m = new Map<string, number>();
    shouldAutoFetch(m, 'ws1', 1_000, CD);
    expect(shouldAutoFetch(m, 'ws1', 30_000, CD)).toBe(false);
    expect(m.get('ws1')).toBe(1_000); // 被擋的觸發不得刷新時計
  });

  it('冷卻期滿 → 再度放行', () => {
    const m = new Map<string, number>();
    shouldAutoFetch(m, 'ws1', 1_000, CD);
    expect(shouldAutoFetch(m, 'ws1', 61_000, CD)).toBe(true);
    expect(m.get('ws1')).toBe(61_000);
  });

  it('不同 key 各自獨立（連切不同工作區不互相干擾）', () => {
    const m = new Map<string, number>();
    expect(shouldAutoFetch(m, 'ws1', 1_000, CD)).toBe(true);
    expect(shouldAutoFetch(m, 'ws2', 2_000, CD)).toBe(true);
    expect(shouldAutoFetch(m, 'ws1', 30_000, CD)).toBe(false);
    expect(shouldAutoFetch(m, 'ws2', 61_999, CD)).toBe(false);
    expect(shouldAutoFetch(m, 'ws2', 62_000, CD)).toBe(true);
  });
});
