// statusHooks 合併安全性單測：對使用者真實 Flow settings 結構，merge 只追加 Polydesk 項、
// 保留全部既有 hook、冪等、壞檔不覆寫；remove 只移除 Polydesk 項。
import { describe, it, expect } from 'vitest';
import { mergeStatusHooks, removeStatusHooks, SCRIPT_MARKER } from './statusHooks';

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
  it('追加 Polydesk 4 事件，且完整保留既有 Flow hooks 與其他設定', () => {
    const before = flowSettings();
    const { settings, changed } = mergeStatusHooks(before, SCRIPT);
    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;

    // 既有 Flow 項全保留（數量 +1 於 PreToolUse/UserPromptSubmit；Notification/Stop 新增）。
    expect(hooks.PreToolUse).toHaveLength(3); // 原 2 + Polydesk 1
    expect(hooks.PreToolUse[0].hooks[0].command).toContain('flow-verify-gate'); // 原項位置不變
    expect(hooks.PreToolUse[1].hooks[0].command).toContain('flow-commit-gate');
    expect(hooks.UserPromptSubmit).toHaveLength(2); // 原 1 + Polydesk 1
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain('flow-size-check');
    expect(hooks.SessionStart).toHaveLength(1); // 未動
    expect(hooks.PostToolUse).toHaveLength(1); // 未動
    expect(hooks.Notification).toHaveLength(1); // 新增
    expect(hooks.Stop).toHaveLength(1); // 新增

    // Polydesk 項指令正確（含標記 + 狀態 argv）。
    const up = hooks.UserPromptSubmit.find((e) => e.hooks[0].command.includes(SCRIPT_MARKER))!;
    expect(up.hooks[0].command).toContain(' working');
    expect(hooks.Notification[0].hooks[0].command).toContain(' awaiting');
    expect(hooks.Notification[0].matcher).toContain('permission_prompt');
    expect(hooks.Stop[0].hooks[0].command).toContain(' done');

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
    expect(hooks.SessionStart).toHaveLength(1); // Flow 未動
  });
});
