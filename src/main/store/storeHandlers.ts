// store:* IPC handlers（P-1 真實實作；其餘 feature 通道為空樁）。

import type { IpcMain } from 'electron';
import type { StateStore } from './StateStore';
import type { InvokeReq } from '../../shared/ipc';

export function registerStoreHandlers(ipc: IpcMain, store: StateStore): void {
  ipc.handle('store:getState', () => store.getAll());

  ipc.handle('store:setTheme', (_e, req: InvokeReq<'store:setTheme'>) => {
    store.setTheme(req.theme);
    return { ok: true } as const;
  });

  ipc.handle('store:setLayout', (_e, req: InvokeReq<'store:setLayout'>) => {
    store.setLayout(req.layout);
    return { ok: true } as const;
  });

  ipc.handle('store:setRailWidth', (_e, req: InvokeReq<'store:setRailWidth'>) => {
    store.setRailWidth(req.width);
    return { ok: true } as const;
  });

  ipc.handle('store:setAiCommit', (_e, req: InvokeReq<'store:setAiCommit'>) => {
    store.setAiCommit(req.cfg);
    return { ok: true } as const;
  });

  ipc.handle('store:export', () => ({ json: store.exportJson() }));

  ipc.handle('store:import', (_e, req: InvokeReq<'store:import'>) => store.importJson(req.json));
}
