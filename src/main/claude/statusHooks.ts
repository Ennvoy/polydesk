// Claude 精準狀態（hooks 整合）：把使用者送指令/跑工具/待確認/完成 對應到 Claude Code hook 事件，
// 寫進使用者全域 ~/.claude/settings.json（merge-safe：只追加 Polydesk 項、絕不動既有 Flow 等 hook）。
// hook 觸發時呼叫 Polydesk 寫的小腳本，把該 session 狀態寫成檔，主程序監看後推給 UI。
//
// 安全要點：
//  - 合併純函式可單測；以「指令含 SCRIPT_MARKER」判定 Polydesk 項，重入冪等（已注入不重複）。
//  - 解析失敗（settings.json 壞）一律放棄注入、回不變，絕不覆寫使用者檔。
//  - 寫檔前先備份一次（settings.json.polydesk-bak）；原子寫（temp+rename）。

import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Polydesk hook 腳本檔名標記（用來在 settings.json 中辨識/去重 Polydesk 注入項）。 */
export const SCRIPT_MARKER = 'polydesk-claude-status';

/** hook 事件 → Polydesk 狀態 argv。matcher 空字串＝全比對。 */
interface HookSpec {
  event: string;
  matcher?: string;
  state: 'working' | 'awaiting' | 'done';
}
const HOOK_SPECS: readonly HookSpec[] = [
  { event: 'UserPromptSubmit', state: 'working' }, // 送出 prompt → 執行中
  { event: 'PreToolUse', matcher: '', state: 'working' }, // 跑工具（含 subagent/workflow）→ 執行中
  { event: 'Notification', matcher: 'permission_prompt|idle_prompt|elicitation_dialog', state: 'awaiting' }, // 待確認
  { event: 'Stop', state: 'done' }, // 完成整個回合 → 已停止
];

interface HookEntry {
  matcher?: string;
  hooks: { type: 'command'; command: string }[];
}

/** 該 entry 是否為 Polydesk 注入項（指令含腳本標記）。 */
function isPolydeskEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const hooks = (entry as HookEntry).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(SCRIPT_MARKER));
}

/** 組 Polydesk hook entry（shell form，與既有 Flow hook 同風格；forward-slash 路徑跨平台）。 */
function buildEntry(scriptPath: string, spec: HookSpec): HookEntry {
  const cmd = `node "${scriptPath.replace(/\\/g, '/')}" ${spec.state}`;
  const entry: HookEntry = { hooks: [{ type: 'command', command: cmd }] };
  if (spec.matcher !== undefined) entry.matcher = spec.matcher;
  return entry;
}

/**
 * 合併純函式：在既有 settings 上「追加」Polydesk 狀態 hook（不動任何既有項），冪等。
 * 回傳 { settings, changed }；settings 為新物件（不就地改）。輸入非物件 → 視為空殼。
 */
export function mergeStatusHooks(
  input: unknown,
  scriptPath: string,
): { settings: Record<string, unknown>; changed: boolean } {
  const settings: Record<string, unknown> =
    input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {};
  const hooksIn = settings.hooks && typeof settings.hooks === 'object' ? (settings.hooks as Record<string, unknown>) : {};
  const hooks: Record<string, unknown> = { ...hooksIn };
  let changed = false;

  for (const spec of HOOK_SPECS) {
    const existing = Array.isArray(hooks[spec.event]) ? [...(hooks[spec.event] as unknown[])] : [];
    if (existing.some(isPolydeskEntry)) continue; // 已注入 → 跳過（冪等）
    existing.push(buildEntry(scriptPath, spec));
    hooks[spec.event] = existing;
    changed = true;
  }

  if (changed) settings.hooks = hooks;
  return { settings, changed };
}

/** 移除所有 Polydesk 注入項（解除安裝用；保留其餘）。回傳 { settings, changed }。 */
export function removeStatusHooks(input: unknown): { settings: Record<string, unknown>; changed: boolean } {
  const settings: Record<string, unknown> =
    input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {};
  if (!settings.hooks || typeof settings.hooks !== 'object') return { settings, changed: false };
  const hooks: Record<string, unknown> = { ...(settings.hooks as Record<string, unknown>) };
  let changed = false;
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    const filtered = list.filter((e) => !isPolydeskEntry(e));
    if (filtered.length !== list.length) {
      changed = true;
      if (filtered.length === 0) delete hooks[event];
      else hooks[event] = filtered;
    }
  }
  if (changed) settings.hooks = hooks;
  return { settings, changed };
}

/** Polydesk claude 狀態根目錄、狀態檔目錄、hook 腳本路徑（固定慣例；腳本與主程序共用）。 */
export function claudePaths(home: string = homedir()): { root: string; statusDir: string; scriptPath: string } {
  const root = join(home, '.claude', 'polydesk');
  return { root, statusDir: join(root, 'status'), scriptPath: join(root, `${SCRIPT_MARKER}.cjs`) };
}

/** hook 腳本內容（Polydesk 寫到磁碟；讀 argv 狀態 + stdin JSON 的 session_id/cwd → 原子寫狀態檔）。 */
export const HOOK_SCRIPT = `#!/usr/bin/env node
// Polydesk Claude 狀態 hook（自動產生，勿手改）。由 ~/.claude/settings.json 的 hook 呼叫。
const fs = require('fs');
const path = require('path');
const state = process.argv[2] || 'done';
// statusDir 相對本腳本位置（<home>/.claude/polydesk/status）——不假設 os.homedir，與主程序 claudePaths 一致。
const statusDir = path.join(__dirname, 'status');
let buf = '';
let done = false;
function flush() {
  if (done) return;
  done = true;
  let sid = 'unknown';
  let cwd = process.cwd();
  try { const j = JSON.parse(buf); if (j && j.session_id) sid = String(j.session_id); if (j && j.cwd) cwd = String(j.cwd); } catch (e) {}
  try {
    fs.mkdirSync(statusDir, { recursive: true });
    const safe = sid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
    const fin = path.join(statusDir, safe + '.json');
    const tmp = fin + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ sessionId: sid, cwd: cwd, state: state, ts: Date.now() }));
    fs.renameSync(tmp, fin);
  } catch (e) {}
  process.exit(0);
}
try { process.stdin.on('data', (d) => { buf += d; }); process.stdin.on('end', flush); } catch (e) {}
setTimeout(flush, 1500);
`;

/**
 * 開機注入：確保 hook 腳本存在 + settings.json 已含 Polydesk 狀態 hook（冪等、merge-safe、備份、原子寫）。
 * 回傳是否有變更。任一步失敗一律吞掉（不讓注入失敗擋住 app 啟動），但壞掉的 settings 絕不覆寫。
 */
export async function installClaudeStatusHooks(home: string = homedir()): Promise<{ changed: boolean }> {
  const { root, scriptPath } = claudePaths(home);
  const settingsPath = join(home, '.claude', 'settings.json');
  try {
    await mkdir(root, { recursive: true });
    await writeFile(scriptPath, HOOK_SCRIPT, 'utf8'); // 腳本內容固定，覆寫無妨

    let raw = '';
    try {
      raw = await readFile(settingsPath, 'utf8');
    } catch {
      raw = ''; // 無 settings.json → 從空殼建
    }
    let parsed: unknown = {};
    if (raw.trim() !== '') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { changed: false }; // 壞檔：放棄，絕不覆寫
      }
    }
    const { settings, changed } = mergeStatusHooks(parsed, scriptPath);
    if (!changed) return { changed: false };

    // 首次變更前備份一次（不覆蓋既有備份）。
    if (raw.trim() !== '') {
      const bak = `${settingsPath}.polydesk-bak`;
      try {
        await access(bak);
      } catch {
        await writeFile(bak, raw, 'utf8');
      }
    }
    const tmp = `${settingsPath}.polydesk-tmp`;
    await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await rename(tmp, settingsPath);
    return { changed: true };
  } catch {
    return { changed: false };
  }
}
