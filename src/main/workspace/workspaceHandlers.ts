// workspace:* IPC handlers（P-3 真實實作，取代 stub）。

import { dialog, type IpcMain } from 'electron';
import type { WorkspaceManager } from './WorkspaceManager';
import type { InvokeReq } from '../../shared/ipc';

export function registerWorkspaceHandlers(ipc: IpcMain, mgr: WorkspaceManager): void {
  ipc.handle('workspace:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '選擇工作區資料夾' });
    return { path: r.canceled || !r.filePaths[0] ? null : r.filePaths[0] };
  });

  ipc.handle('workspace:pickCloneParent', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '選擇 Repository 存放位置' });
    return { path: r.canceled || !r.filePaths[0] ? null : r.filePaths[0] };
  });

  ipc.handle('workspace:list', () => mgr.list());
  ipc.handle('workspace:add', (_e, req: InvokeReq<'workspace:add'>) => mgr.add(req));
  ipc.handle('workspace:remove', async (_e, req: InvokeReq<'workspace:remove'>) => {
    await mgr.remove(req.wsId, req.purgeProfile);
    return { ok: true } as const;
  });
  ipc.handle('workspace:rename', (_e, req: InvokeReq<'workspace:rename'>) => {
    mgr.rename(req.wsId, req.name);
    return { ok: true } as const;
  });
  ipc.handle('workspace:reorder', (_e, req: InvokeReq<'workspace:reorder'>) => {
    mgr.reorder(req.orderedIds);
    return { ok: true } as const;
  });
  ipc.handle('workspace:activate', (_e, req: InvokeReq<'workspace:activate'>) => {
    mgr.activate(req.wsId);
    return { ok: true } as const;
  });
  ipc.handle('workspace:setShell', (_e, req: InvokeReq<'workspace:setShell'>) => {
    mgr.setDefaultShell(req.wsId, req.shell);
    return { ok: true } as const;
  });
}
