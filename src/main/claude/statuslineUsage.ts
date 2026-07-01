// claude 用量注入：claude 只把 rate_limits 餵給 statusline（不寫 transcript/快取），故 Polydesk 在使用者的
// ~/.claude/statusline.ps1 尾部注入一段「順手把 rate_limits 寫成 usage.json」，主程序再讀那個檔。
//
// 安全：marker 標記、冪等（已注入跳過）、首次備份、無 statusline.ps1 則略過；注入段用 $j（statusline 已 parse 的
// stdin JSON）取 rate_limits 並 try/catch 容錯（使用者改腳本也不會壞原 statusline）。marker/註解全 ASCII，避免 .ps1
// 編碼問題。讀寫既有 statusline.ps1 一律偵測並「保留其原始編碼」（UTF-8/UTF-16LE ±BOM 皆 round-trip），
// 無法安全處理的編碼（UTF-16BE / Big5 等單位元組）則跳過注入，絕不以錯誤編碼覆寫使用者腳本（PS 編碼鐵則）。

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MARKER_BEGIN = '# === POLYDESK-USAGE-BEGIN (auto, do not edit) ===';
const MARKER_END = '# === POLYDESK-USAGE-END ===';

/** 注入段（PowerShell，全 ASCII）：用 statusline 已 parse 的 $j 取 rate_limits，寫 ~/.claude/polydesk/usage.json。 */
function usageBlock(): string {
  return [
    MARKER_BEGIN,
    'try {',
    '  if ($j -and $j.rate_limits) {',
    "    $pdUsageDir = Join-Path $env:USERPROFILE '.claude\\polydesk'",
    '    if (-not (Test-Path $pdUsageDir)) { New-Item -ItemType Directory -Path $pdUsageDir -Force | Out-Null }',
    '    @{',
    '      fiveHourPct = $j.rate_limits.five_hour.used_percentage',
    '      fiveHourReset = $j.rate_limits.five_hour.resets_at',
    '      sevenDayPct = $j.rate_limits.seven_day.used_percentage',
    '      sevenDayReset = $j.rate_limits.seven_day.resets_at',
    '      ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
    "    } | ConvertTo-Json -Compress | Out-File (Join-Path $pdUsageDir 'usage.json') -Encoding utf8 -Force",
    '  }',
    '} catch {}',
    MARKER_END,
  ].join('\r\n');
}

type Ps1File = { text: string; encode: (s: string) => Buffer };

/** 讀 statusline.ps1 並保留其原始編碼：回傳 text 與寫回用的 encode。
 *  UTF-16LE(±BOM) 與 UTF-8(±BOM) 可安全 round-trip；UTF-16BE 或非 UTF-8 單位元組編碼（Big5 等）回 null → 呼叫端跳過。 */
async function readPreservingEncoding(path: string): Promise<Ps1File | null> {
  const buf = await readFile(path);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.toString('utf16le'), encode: (s) => Buffer.from(s, 'utf16le') }; // UTF-16LE（BOM 隨 text 保留）
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return null; // UTF-16BE：Node 無法原生 encode，保守跳過
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf); // 含 UTF-8 BOM 時 text 首字 ﻿，round-trip 保留
    return { text, encode: (s) => Buffer.from(s, 'utf8') };
  } catch {
    return null; // Big5 等非 UTF-8 單位元組編碼：不冒險改寫使用者腳本
  }
}

/** 開機注入：statusline.ps1 尾部加 usage 段（冪等、備份、保留原編碼）。無檔或無法安全處理的編碼 → 略過。 */
export async function installStatuslineUsage(home: string = homedir()): Promise<{ changed: boolean }> {
  const path = join(home, '.claude', 'statusline.ps1');
  let file: Ps1File | null;
  try {
    file = await readPreservingEncoding(path);
  } catch {
    return { changed: false }; // 使用者沒設 statusline.ps1
  }
  if (!file) return { changed: false }; // 無法安全處理的編碼 → 不注入（不冒險寫壞使用者腳本）
  const { text, encode } = file;
  if (text.includes(MARKER_BEGIN)) return { changed: false }; // 冪等
  const bak = `${path}.polydesk-usage-bak`;
  try {
    await access(bak);
  } catch {
    await writeFile(bak, encode(text)); // 首次備份（原編碼；不覆蓋既有備份）
  }
  const updated = `${text.replace(/\s+$/, '')}\r\n\r\n${usageBlock()}\r\n`;
  await writeFile(path, encode(updated));
  return { changed: true };
}

/** 移除注入段（解除安裝用）；同樣偵測並保留原編碼。 */
export async function removeStatuslineUsage(home: string = homedir()): Promise<{ changed: boolean }> {
  const path = join(home, '.claude', 'statusline.ps1');
  let file: Ps1File | null;
  try {
    file = await readPreservingEncoding(path);
  } catch {
    return { changed: false };
  }
  if (!file) return { changed: false };
  const { text, encode } = file;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\r?\\n*${esc(MARKER_BEGIN)}[\\s\\S]*?${esc(MARKER_END)}`, 'g');
  if (!re.test(text)) return { changed: false };
  await writeFile(path, encode(text.replace(re, '')));
  return { changed: true };
}
