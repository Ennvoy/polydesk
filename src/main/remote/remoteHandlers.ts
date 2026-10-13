import { app, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { RemoteService, type RemoteGateway } from './RemoteService';
import { TailscaleGateway } from './TailscaleGateway';
import { getMainWindow, emit } from '../ipc/broadcast';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';
import type { PtyManager } from '../pty/PtyManager';
import type { PairLifetime, RemoteResult } from '../../shared/remoteLaunch';
import { closeGate } from '../window/windowControls';

export function registerRemoteHandlers(ipc: IpcMain, workspaces: WorkspaceManager, pty: PtyManager, userData: string, interactive: () => boolean): RemoteService {
  // Test gateway is isolated to unpackaged E2E processes; portable cannot enable it.
  const testMode = !app.isPackaged && process.env['POLYDESK_E2E_REMOTE_GATEWAY'] === '1';
  const gateway: RemoteGateway = testMode ? { enable: async () => 'https://poly.test:8443', verify: async () => undefined, disable: async () => undefined } : new TailscaleGateway();
  const ready = (): boolean => {
    const w = getMainWindow(); return interactive() && !closeGate.confirmed() && !!w && !w.webContents.isDestroyed() && !w.webContents.isCrashed();
  };
  const service = new RemoteService({
    statePath: join(userData, 'remote-state.json'), gateway, workspaces: () => workspaces.list(), ready,
    terminalCount: () => workspaces.list().reduce((n, w) => n + pty.list(w.id).length, 0),
    create: (wsId, shell) => pty.create({ wsId, shell }),
    emit: payload => { const w = getMainWindow(); if (!w || !ready()) throw new Error('視窗未就緒'); if (w.isMinimized()) w.restore(); w.show(); w.focus(); emit('remote:launch', payload); },
    dimensions: id => pty.dimensions(id), write: (id, data) => pty.write(id, data), close: async id => { pty.close({ termId: id }); },
  });
  const own = (e: IpcMainInvokeEvent): void => {
    if (e.sender !== getMainWindow()?.webContents || e.senderFrame !== e.sender.mainFrame) throw new Error('不允許此來源操作。');
  };
  const action = (fn: (req: unknown) => void | Promise<void>) => async (e: IpcMainInvokeEvent, req: unknown): Promise<RemoteResult> => {
    try { own(e); await fn(req); return { ok: true }; } catch (error) { return { error: error instanceof Error ? error.message : '遠端操作失敗。' }; }
  };
  const obj = (req: unknown): Record<string, unknown> => { if (!req || typeof req !== 'object' || Array.isArray(req)) throw new Error('資料不正確。'); return req as Record<string, unknown>; };
  const id = (req: unknown, key = 'id'): string => { const v = obj(req)[key]; if (typeof v !== 'string' || v.length < 1 || v.length > 100) throw new Error('識別碼不正確。'); return v; };
  ipc.handle('remote:status', e => { own(e); return service.status(); });
  ipc.handle('remote:enable', action(() => service.enable()));
  ipc.handle('remote:disable', action(() => service.disable()));
  ipc.handle('remote:challenge', async e => {
    try { own(e); const c = service.createChallenge(); const qr = await QRCode.toDataURL(c.url, { width: 216, margin: 2, errorCorrectionLevel: 'M' }); return { ...c, qr }; }
    catch (error) { return { error: error instanceof Error ? error.message : '無法產生配對碼。' }; }
  });
  ipc.handle('remote:approve', action(req => service.approve(id(req), obj(req).lifetime as PairLifetime)));
  ipc.handle('remote:reject', action(req => service.reject(id(req))));
  ipc.handle('remote:revoke', action(req => service.revoke(id(req))));
  ipc.handle('remote:allowWorkspace', action(req => { const b = obj(req); if (typeof b.allowed !== 'boolean') throw new Error('授權資料不正確。'); service.allowWorkspace(id(req, 'wsId'), b.allowed); }));
  ipc.handle('remote:ready', action(req => service.rendererReady(id(req, 'opId'), id(req, 'termId'))));
  return service;
}
