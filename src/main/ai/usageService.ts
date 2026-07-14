// 總覽用量：claude（由 statusline 注入段寫的 usage.json）+ codex（最新 rollout 尾端的 token_count.rate_limits）。
// 兩者皆容錯：讀不到/解析失敗回 undefined（總覽顯示 --），永不丟例外。

import { readFile, readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IpcMain } from 'electron';
import type { AiUsage, RateWindow } from '../../shared/types';
import { codexSessionsRoot } from '../monitor/codexRollout';

/** 各種 reset 表示（unix 秒 / 毫秒 / ISO 字串）統一成 unix 秒。 */
function toEpochSec(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v; // 毫秒→秒
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return toEpochSec(Number(v));
    const d = Date.parse(v);
    return Number.isFinite(d) ? Math.floor(d / 1000) : undefined;
  }
  return undefined;
}

/** claude：讀 statusline 注入段寫的 ~/.claude/polydesk/usage.json（容 PS Out-File 的 BOM）。 */
export async function readClaudeUsage(home: string): Promise<AiUsage['claude']> {
  try {
    const raw = await readFile(join(home, '.claude', 'polydesk', 'usage.json'), 'utf8');
    // PS 5.1 的 Out-File -Encoding utf8 會寫入 BOM，JSON.parse 不剝會拋錯 → 用量卡永遠空白，故先剝 BOM。
    const j = JSON.parse(raw.replace(/^﻿/, '')) as Record<string, unknown>;
    const win = (pct: unknown, reset: unknown): RateWindow | undefined =>
      typeof pct === 'number' ? { usedPercent: pct, resetsAt: toEpochSec(reset) } : undefined;
    return { fiveHour: win(j.fiveHourPct, j.fiveHourReset), sevenDay: win(j.sevenDayPct, j.sevenDayReset) };
  } catch {
    return undefined;
  }
}

/** 讀檔尾 N bytes（找最後的 token_count event）。 */
async function readTail(path: string, size: number, bytes: number): Promise<string> {
  const start = Math.max(0, size - bytes);
  const len = size - start;
  if (len <= 0) return '';
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * 從 rollout 尾端找最後的 token_count.rate_limits。
 * 舊格式通常 primary=5h、secondary=週；新格式可能只回 primary=週，故必須以 window_minutes
 * 判斷實際週期，不能再用欄位名稱硬套，否則會把每週用量誤標成「5 小時」。
 */
export function parseCodexRateLimits(tail: string): AiUsage['codex'] {
  type RawWindow = { used_percent?: number; resets_at?: number; window_minutes?: number };
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (!s || !s.includes('rate_limits')) continue;
    try {
      const j = JSON.parse(s) as { payload?: { type?: string; rate_limits?: Record<string, RawWindow> } };
      const rl = j.payload?.rate_limits;
      if (rl) {
        const win = (w?: RawWindow): RateWindow | undefined =>
          w && typeof w.used_percent === 'number' ? { usedPercent: w.used_percent, resetsAt: w.resets_at } : undefined;
        const primary = rl.primary;
        const secondary = rl.secondary;
        const entries = [primary, secondary].filter((w): w is RawWindow => Boolean(w));
        const byMinutes = (test: (minutes: number) => boolean): RateWindow | undefined => {
          const raw = entries.find((w) => typeof w.window_minutes === 'number' && test(w.window_minutes));
          return win(raw);
        };
        const hasWindowMetadata = entries.some((w) => typeof w.window_minutes === 'number');
        return {
          fiveHour: hasWindowMetadata ? byMinutes((minutes) => minutes > 0 && minutes < 24 * 60) : win(primary),
          sevenDay: hasWindowMetadata ? byMinutes((minutes) => minutes >= 24 * 60) : win(secondary),
          planType: typeof (rl as { plan_type?: unknown }).plan_type === 'string' ? (rl as { plan_type: string }).plan_type : undefined,
        };
      }
    } catch {
      /* 半行/壞行 skip */
    }
  }
  return undefined;
}

/** codex：全域額度（一帳號一份）→ 讀近兩天內 mtime 最新的 rollout 尾端 rate_limits。 */
async function readCodexUsage(root: string, now: number): Promise<AiUsage['codex']> {
  let latest: { path: string; mtime: number; size: number } | null = null;
  for (let d = 0; d < 2; d++) {
    const date = new Date(now - d * 24 * 60 * 60 * 1000);
    const dir = join(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'));
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.startsWith('rollout-') || !f.endsWith('.jsonl')) continue;
      const p = join(dir, f);
      try {
        const st = await stat(p);
        if (!latest || st.mtimeMs > latest.mtime) latest = { path: p, mtime: st.mtimeMs, size: st.size };
      } catch {
        /* skip */
      }
    }
  }
  if (!latest) return undefined;
  try {
    return parseCodexRateLimits(await readTail(latest.path, latest.size, 128 * 1024));
  } catch {
    return undefined;
  }
}

/** 讀 claude + codex 用量（各自容錯）。 */
export async function readAiUsage(home: string = homedir(), now: number = Date.now()): Promise<AiUsage> {
  const [claude, codex] = await Promise.all([
    readClaudeUsage(home).catch(() => undefined),
    readCodexUsage(codexSessionsRoot(home), now).catch(() => undefined),
  ]);
  return { claude, codex };
}

export function registerUsageHandler(ipc: IpcMain): void {
  ipc.handle('ai:usage', () => readAiUsage());
}
