// Preload（contextIsolation + sandbox 橋）：依 channels 單一真相動態產出
// 最小 namespaced API（一個 IPC 一個方法），絕不外洩 raw ipcRenderer / Node API。
// 例：window.polydesk.store.getState()、window.polydesk.events.claude.status(cb)。

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { INVOKE_CHANNELS, EVENT_CHANNELS, PTY_DATA, PTY_WRITE } from '../shared/channels';

type Method = (...args: unknown[]) => unknown;
type Ns = Record<string, Method>;

// invoke：每個通道一個 closure（綁定固定 channel = 白名單）
const invokeApi: Record<string, Ns> = {};
for (const ch of INVOKE_CHANNELS) {
  const [ns, method] = ch.split(':') as [string, string];
  (invokeApi[ns] ??= {})[method] = (req?: unknown) => ipcRenderer.invoke(ch, req);
}

// event：每個事件一個訂閱 closure，回傳 unsubscribe
const eventApi: Record<string, Ns> = {};
for (const ch of EVENT_CHANNELS) {
  const [ns, method] = ch.split(':') as [string, string];
  (eventApi[ns] ??= {})[method] = ((cb: (payload: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(ch, listener);
    return () => {
      ipcRenderer.removeListener(ch, listener);
    };
  }) as Method;
}

// PTY 高頻資料流（不走 invoke）
const ptyNs = (invokeApi.pty ??= {});
ptyNs.write = ((termId: string, data: string) => {
  ipcRenderer.send(PTY_WRITE, { termId, data });
}) as Method;
ptyNs.onData = ((cb: (payload: { termId: string; chunk: Uint8Array }) => void) => {
  const listener = (_e: IpcRendererEvent, payload: { termId: string; chunk: Uint8Array }) => cb(payload);
  ipcRenderer.on(PTY_DATA, listener);
  return () => {
    ipcRenderer.removeListener(PTY_DATA, listener);
  };
}) as Method;

const api = { ...invokeApi, events: eventApi };

contextBridge.exposeInMainWorld('polydesk', api);
