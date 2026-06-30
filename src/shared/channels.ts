// IPC 通道名常數（main / preload / renderer 共用單一真相）。
// 與 ipc.ts 的型別表保持同步——下方 compile-time 檢查會在漏列/拼錯時報錯。

import type { InvokeChannel, EventChannel } from './ipc';

export const INVOKE_CHANNELS = [
  'workspace:list',
  'workspace:add',
  'workspace:remove',
  'workspace:rename',
  'workspace:reorder',
  'workspace:activate',
  'workspace:setShell',
  'workspace:pickFolder',
  'fs:read',
  'fs:write',
  'fs:tree',
  'fs:create',
  'fs:rename',
  'fs:delete',
  'fs:copy',
  'fs:reveal',
  'git:status',
  'git:changes',
  'git:diff',
  'git:stage',
  'git:discard',
  'git:ignore',
  'git:commit',
  'git:push',
  'git:pull',
  'git:branch',
  'git:log',
  'git:show',
  'git:commitFiles',
  'git:stash',
  'git:init',
  'ai:generateCommitMessage',
  'pty:create',
  'pty:resize',
  'pty:close',
  'pty:list',
  'search:run',
  'search:cancel',
  'lsp:probe',
  'lsp:install',
  'lsp:request',
  'lsp:sync',
  'playwright:wire',
  'playwright:status',
  'store:getState',
  'store:setTheme',
  'store:setLayout',
  'store:setRailWidth',
  'store:setAiCommit',
  'store:export',
  'store:import',
  'update:check',
  'update:install',
  'window:minimize',
  'window:maximizeToggle',
  'window:close',
  'window:isMaximized',
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = [
  'claude:status',
  'fs:change',
  'pty:exit',
  'search:result',
  'lsp:diagnostics',
  'update:progress',
  'window:maximizedChange',
] as const satisfies readonly EventChannel[];

/** PTY 高頻資料流通道（不走 invoke）。 */
export const PTY_DATA = 'pty:data';
export const PTY_WRITE = 'pty:write';

// ── compile-time 完整性守門：若有型別通道未列入上方陣列即報錯（單一真相不漂移）──
const _checkInvokeComplete: [Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>] extends [never]
  ? true
  : never = true;
const _checkEventComplete: [Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>] extends [never]
  ? true
  : never = true;
void _checkInvokeComplete;
void _checkEventComplete;
