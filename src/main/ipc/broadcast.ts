// main→renderer 事件廣播（整合接縫）：持有主視窗參照，features 經 emit 推 event/stream 通道。
// 避免各 feature 各自抓 BrowserWindow；視窗未就緒/已銷毀時安全 no-op。

import type { BrowserWindow } from 'electron';
import type { EventChannels } from '../../shared/ipc';

let win: BrowserWindow | null = null;

export function setMainWindow(w: BrowserWindow | null): void {
  win = w;
}

/** 取目前主視窗參照（視窗控制 handler 於呼叫時取用；未就緒回 null）。 */
export function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/** 推一個型別化 event 通道（payload 對齊 EventChannels）。 */
export function emit<C extends keyof EventChannels>(channel: C, payload: EventChannels[C]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** 推原始通道（PTY 高頻資料流 pty:data 等非 event 通道用）。 */
export function emitRaw(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
