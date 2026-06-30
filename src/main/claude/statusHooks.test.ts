// statusHooks 合併安全性單測：對使用者真實 Flow settings 結構，merge 只追加 Polydesk 項、
// 保留全部既有 hook、冪等、壞檔不覆寫；remove 只移除 Polydesk 項。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeStatusHooks, removeStatusHooks, installClaudeStatusHooks, claudePaths, SCRIPT_MARKER } from './statusHooks';

const SCRIPT = 'C:/Users/u/.claude/polydesk/polydesk-claude-status.cjs';

// 仿使用者實際 ~/.claude/settings.json 的 Flow hook 結構（節錄關鍵）。
function flowSettings(): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        { matcher: 'TaskUpdate', hooks: [{ type: 'command', command: 'node "C:/x/flow-verify-gate.mjs"' }] },
        { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node "C:/x/flow-commit-gate.mjs"' }] },
      ],
      SessionStart: [{ hooks: [{ type: 'command', command: 'node "C:/x/flow-session-start.mjs"' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "C:/x/flow-size-check.mjs"' }] }],
      PostToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node "C:/x/flow-stall-monitor.mjs"' }] }],
    },
    statusLine: { type: 'command', command: 'powershell ... statusline.ps1' },
    effortLevel: 'xhigh',
    theme: 'dark',
  };
}

describe('statusHooks — 合併安全性', () => {
  it('追加 Polydesk 6 事件（含 SessionStart/SessionEnd），且完整保留既有 Flow hooks 與其他設定', () => {
    const before = flowSettings();
    const { settings, changed } = mergeStatusHooks(before, SCRIPT);
    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;

    // 既有 Flow 項全保留（有 Flow hook 的事件數量 +1；純 Polydesk 事件新增）。
    expect(hooks.PreToolUse).toHaveLength(3); // 原 2 + Polydesk 1
    expect(hooks.PreToolUse[0].hooks[0].command).toContain('flow-verify-gate'); // 原項位置不變
    expect(hooks.PreToolUse[1].hooks[0].command).toContain('flow-commit-gate');
    expect(hooks.UserPromptSubmit).toHaveLength(2); // 原 1 + Polydesk 1
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain('flow-size-check');
    expect(hooks.SessionStart).toHaveLength(2); // 原 Flow 1 + Polydesk reset 1
    expect(hooks.SessionStart[0].hooks[0].command).toContain('flow-session-start'); // Flow 原項位置不變
    expect(hooks.PostToolUse).toHaveLength(1); // 未動
    expect(hooks.Notification).toHaveLength(1); // 新增
    expect(hooks.Stop).toHaveLength(1); // 新增
    expect(hooks.SessionEnd).toHaveLength(1); // 新增（Flow 無此事件）

    // Polydesk 項指令正確（含標記 + 狀態 argv）。
    const up = hooks.UserPromptSubmit.find((e) => e.hooks[0].command.includes(SCRIPT_MARKER))!;
    expect(up.hooks[0].command).toContain(' working');
    expect(hooks.Notification[0].hooks[0].command).toContain(' awaiting');
    expect(hooks.Notification[0].matcher).toContain('permission_prompt');
    expect(hooks.Stop[0].hooks[0].command).toContain(' done');
    const ss = hooks.SessionStart.find((e) => e.hooks[0].command.includes(SCRIPT_MARKER))!;
    expect(ss.hooks[0].command).toContain(' reset'); // SessionStart → 清殘留 + 標已停止
    expect(hooks.SessionEnd[0].hooks[0].command).toContain(' end'); // SessionEnd → 刪狀態檔

    // 其他頂層設定原封不動。
    expect(settings.statusLine).toEqual(before.statusLine);
    expect(settings.effortLevel).toBe('xhigh');
  });

  it('不就地修改輸入物件（純函式）', () => {
    const before = flowSettings();
    const beforeJson = JSON.stringify(before);
    mergeStatusHooks(before, SCRIPT);
    expect(JSON.stringify(before)).toBe(beforeJson); // 輸入未被改
  });

  it('冪等：第二次合併不再變更、不重複注入', () => {
    const first = mergeStatusHooks(flowSettings(), SCRIPT);
    const second = mergeStatusHooks(first.settings, SCRIPT);
    expect(second.changed).toBe(false);
    const hooks = second.settings.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(3); // 沒有變 4
    expect(hooks.Stop).toHaveLength(1);
  });

  it('無 hooks / 空殼 / 非物件輸入皆安全建立', () => {
    expect(mergeStatusHooks({}, SCRIPT).changed).toBe(true);
    expect(mergeStatusHooks(null, SCRIPT).changed).toBe(true);
    expect(mergeStatusHooks('garbage', SCRIPT).changed).toBe(true);
    const { settings } = mergeStatusHooks(undefined, SCRIPT);
    expect((settings.hooks as Record<string, unknown[]>).UserPromptSubmit).toHaveLength(1);
  });

  it('remove 只移除 Polydesk 項、保留 Flow 項，並還原為注入前狀態', () => {
    const before = flowSettings();
    const injected = mergeStatusHooks(before, SCRIPT).settings;
    const { settings, changed } = removeStatusHooks(injected);
    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(2); // 回到原 2
    expect(hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.Notification).toBeUndefined(); // 純 Polydesk 事件被整個移除
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.SessionEnd).toBeUndefined(); // 純 Polydesk 事件被整個移除
    expect(hooks.SessionStart).toHaveLength(1); // Flow 未動（只移除 Polydesk reset 項）
  });
});

describe('installClaudeStatusHooks — 真實 fs 安裝（temp HOME）', () => {
  it('注入到 settings.json（保留 Flow）、寫腳本、備份、冪等', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-hooks-'));
    try {
      mkdirSync(join(home, '.claude'), { recursive: true });
      const settingsPath = join(home, '.claude', 'settings.json');
      const original = JSON.stringify(flowSettings(), null, 2);
      writeFileSync(settingsPath, original, 'utf8');

      // 第一次安裝 → changed
      const r1 = await installClaudeStatusHooks(home);
      expect(r1.changed).toBe(true);

      // hook 腳本已寫
      const { scriptPath } = claudePaths(home);
      expect(existsSync(scriptPath)).toBe(true);
      expect(readFileSync(scriptPath, 'utf8')).toContain('polydesk');

      // settings.json 含 Polydesk hook + 保留 Flow
      const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(after.hooks.PreToolUse).toHaveLength(3);
      expect(after.hooks.PreToolUse[0].hooks[0].command).toContain('flow-verify-gate');
      expect(after.hooks.Stop[0].hooks[0].command).toContain(SCRIPT_MARKER);
      expect(after.statusLine).toBeDefined(); // 其他設定保留

      // 備份 = 原始內容
      expect(readFileSync(`${settingsPath}.polydesk-bak`, 'utf8')).toBe(original);

      // 第二次安裝 → 冪等（無變更、不重複）
      const r2 = await installClaudeStatusHooks(home);
      expect(r2.changed).toBe(false);
      expect(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.PreToolUse).toHaveLength(3);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('安裝後的 hook 腳本實跑：餵 stdin JSON → 寫出狀態檔（state/cwd/sessionId）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-hooks-'));
    try {
      mkdirSync(join(home, '.claude'), { recursive: true });
      await installClaudeStatusHooks(home);
      const { scriptPath, statusDir } = claudePaths(home);
      // 模擬 Claude Code 呼叫 hook：argv 狀態 + stdin JSON
      execFileSync('node', [scriptPath, 'awaiting'], {
        input: JSON.stringify({ session_id: 'abc123', cwd: 'C:/p/a', hook_event_name: 'Notification' }),
        encoding: 'utf8',
      });
      const f = join(statusDir, 'abc123.json');
      expect(existsSync(f)).toBe(true);
      const j = JSON.parse(readFileSync(f, 'utf8'));
      expect(j.state).toBe('awaiting');
      expect(j.cwd).toBe('C:/p/a');
      expect(j.sessionId).toBe('abc123');
      expect(typeof j.ts).toBe('number');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('settings.json 壞檔 → 放棄注入、不覆寫', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-hooks-'));
    try {
      mkdirSync(join(home, '.claude'), { recursive: true });
      const settingsPath = join(home, '.claude', 'settings.json');
      writeFileSync(settingsPath, '{ this is not valid json', 'utf8');
      const r = await installClaudeStatusHooks(home);
      expect(r.changed).toBe(false);
      expect(readFileSync(settingsPath, 'utf8')).toBe('{ this is not valid json'); // 原樣未動
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('hook 腳本 reset(SessionStart)：清掉同 cwd 殘留 working + 自己標 done、不誤刪別工作區', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-hooks-'));
    try {
      mkdirSync(join(home, '.claude'), { recursive: true });
      await installClaudeStatusHooks(home);
      const { scriptPath, statusDir } = claudePaths(home);
      mkdirSync(statusDir, { recursive: true });
      // 殘留：上次 session 沒收到 Stop，留下 working（同工作區 C:/proj/a）。
      writeFileSync(join(statusDir, 'old-sid.json'), JSON.stringify({ sessionId: 'old-sid', cwd: 'C:/proj/a', state: 'working', ts: 1 }));
      // 別工作區（C:/proj/b）的 working 不該被誤刪。
      writeFileSync(join(statusDir, 'other-ws.json'), JSON.stringify({ sessionId: 'other-ws', cwd: 'C:/proj/b', state: 'working', ts: 1 }));
      // 新 session 在 C:/proj/a 啟動（SessionStart → reset）。
      execFileSync('node', [scriptPath, 'reset'], {
        input: JSON.stringify({ session_id: 'new-sid', cwd: 'C:/proj/a', hook_event_name: 'SessionStart' }),
        encoding: 'utf8',
      });
      expect(existsSync(join(statusDir, 'old-sid.json'))).toBe(false); // 同 cwd 殘留被清
      expect(existsSync(join(statusDir, 'other-ws.json'))).toBe(true); // 別工作區未誤刪
      const nf = join(statusDir, 'new-sid.json');
      expect(existsSync(nf)).toBe(true);
      expect(JSON.parse(readFileSync(nf, 'utf8')).state).toBe('done'); // 剛啟動 = 已停止（非執行中）
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('hook 腳本 end(SessionEnd)：刪本 session 狀態檔', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-hooks-'));
    try {
      mkdirSync(join(home, '.claude'), { recursive: true });
      await installClaudeStatusHooks(home);
      const { scriptPath, statusDir } = claudePaths(home);
      mkdirSync(statusDir, { recursive: true });
      writeFileSync(join(statusDir, 'sid9.json'), JSON.stringify({ sessionId: 'sid9', cwd: 'C:/p', state: 'working', ts: 1 }));
      execFileSync('node', [scriptPath, 'end'], {
        input: JSON.stringify({ session_id: 'sid9', cwd: 'C:/p', hook_event_name: 'SessionEnd' }),
        encoding: 'utf8',
      });
      expect(existsSync(join(statusDir, 'sid9.json'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
