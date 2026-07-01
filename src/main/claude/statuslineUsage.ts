// claude 用量注入：claude 只把 rate_limits 餵給 statusline（不寫 transcript/快取），故 Polydesk 在使用者的
// ~/.claude/statusline.ps1 尾部注入一段「順手把 rate_limits 寫成 usage.json」，主程序再讀那個檔。
//
// 安全：marker 標記、冪等（已注入跳過）、首次備份、無 statusline.ps1 則略過；注入段用 $j（statusline 已 parse 的
// stdin JSON）取 rate_limits 並 try/catch 容錯（使用者改腳本也不會壞原 statusline）。marker/註解全 ASCII，避免 .ps1
// 編碼問題；寫檔保持原內容（含既有 BOM）。

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

/** 開機注入：statusline.ps1 尾部加 usage 段（冪等、備份）。無 statusline.ps1 → 略過（claude 用量取不到，總覽顯示 --）。 */
export async function installStatuslineUsage(home: string = homedir()): Promise<{ changed: boolean }> {
  const path = join(home, '.claude', 'statusline.ps1');
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return { changed: false }; // 使用者沒設 statusline.ps1
  }
  if (content.includes(MARKER_BEGIN)) return { changed: false }; // 冪等
  const bak = `${path}.polydesk-usage-bak`;
  try {
    await access(bak);
  } catch {
    await writeFile(bak, content, 'utf8'); // 首次備份（不覆蓋既有備份）
  }
  const updated = `${content.replace(/\s+$/, '')}\r\n\r\n${usageBlock()}\r\n`;
  await writeFile(path, updated, 'utf8');
  return { changed: true };
}

/** 移除注入段（解除安裝用）。 */
export async function removeStatuslineUsage(home: string = homedir()): Promise<{ changed: boolean }> {
  const path = join(home, '.claude', 'statusline.ps1');
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return { changed: false };
  }
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\r?\\n*${esc(MARKER_BEGIN)}[\\s\\S]*?${esc(MARKER_END)}`, 'g');
  if (!re.test(content)) return { changed: false };
  await writeFile(path, content.replace(re, ''), 'utf8');
  return { changed: true };
}
