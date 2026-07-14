// usageService：codex rollout token_count.rate_limits 依 window_minutes 辨識週期 + claude usage.json BOM 容錯。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodexRateLimits, readClaudeUsage } from './usageService';

describe('parseCodexRateLimits', () => {
  const tokenCount = (rl: unknown): string => JSON.stringify({ timestamp: '2026-07-01T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: rl } });

  it('取 primary→5h、secondary→週、plan_type', () => {
    const tail = tokenCount({
      primary: { used_percent: 9, window_minutes: 300, resets_at: 1782882616 },
      secondary: { used_percent: 5, window_minutes: 10080, resets_at: 1783394605 },
      plan_type: 'plus',
    });
    const u = parseCodexRateLimits(tail);
    expect(u?.fiveHour).toEqual({ usedPercent: 9, resetsAt: 1782882616 });
    expect(u?.sevenDay).toEqual({ usedPercent: 5, resetsAt: 1783394605 });
    expect(u?.planType).toBe('plus');
  });

  it('取尾端「最後一個」token_count（後蓋前）', () => {
    const tail = [
      tokenCount({ primary: { used_percent: 1, resets_at: 1 }, secondary: { used_percent: 1, resets_at: 1 } }),
      tokenCount({ primary: { used_percent: 42, resets_at: 999 }, secondary: { used_percent: 7, resets_at: 888 } }),
    ].join('\n');
    expect(parseCodexRateLimits(tail)?.fiveHour?.usedPercent).toBe(42);
  });

  it('新格式只回 primary=每週時，不誤標成 5 小時', () => {
    const tail = tokenCount({
      primary: { used_percent: 26, window_minutes: 10080, resets_at: 1784509528 },
      secondary: null,
      plan_type: 'plus',
    });
    const u = parseCodexRateLimits(tail);
    expect(u?.fiveHour).toBeUndefined();
    expect(u?.sevenDay).toEqual({ usedPercent: 26, resetsAt: 1784509528 });
  });

  it('無 rate_limits / 半行 → undefined，不崩', () => {
    expect(parseCodexRateLimits('')).toBeUndefined();
    expect(parseCodexRateLimits('{"broken jso\n')).toBeUndefined();
    expect(parseCodexRateLimits(JSON.stringify({ payload: { type: 'agent_message' } }))).toBeUndefined();
  });
});

describe('readClaudeUsage（claude usage.json）', () => {
  it('PS Out-File -Encoding utf8 帶 BOM 的 usage.json 仍能解析（codex P2-1）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-usage-'));
    mkdirSync(join(home, '.claude', 'polydesk'), { recursive: true });
    const json = JSON.stringify({ fiveHourPct: 42, fiveHourReset: 1782882616, sevenDayPct: 7, sevenDayReset: 1783394605 });
    writeFileSync(join(home, '.claude', 'polydesk', 'usage.json'), '﻿' + json, 'utf8'); // 前置 BOM（模擬 PS Out-File utf8）
    try {
      const u = await readClaudeUsage(home);
      expect(u?.fiveHour?.usedPercent).toBe(42);
      expect(u?.sevenDay?.usedPercent).toBe(7);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
