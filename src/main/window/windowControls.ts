// 視窗控制 handlers（frame:false 自訂無框標題列）：renderer 自畫的 min/max/close
// 經此操作真實 BrowserWindow。一次性註冊（getMainWindow 於呼叫時取目前視窗，容 createWindow 重建）。

import type { IpcMain } from 'electron';
import { getMainWindow } from '../ipc/broadcast';
import type { InvokeRes } from '../../shared/ipc';

export function registerWindowControls(ipc: IpcMain): void {
  ipc.handle('window:minimize', (): InvokeRes<'window:minimize'> => {
    getMainWindow()?.minimize();
    return { ok: true } as const;
  });
  ipc.handle('window:maximizeToggle', (): InvokeRes<'window:maximizeToggle'> => {
    const w = getMainWindow();
    if (w) {
      if (w.isMaximized()) w.unmaximize();
      else w.maximize();
    }
    return { maximized: w?.isMaximized() ?? false };
  });
  ipc.handle('window:close', (): InvokeRes<'window:close'> => {
    getMainWindow()?.close();
    return { ok: true } as const;
  });
  ipc.handle('window:isMaximized', (): InvokeRes<'window:isMaximized'> => {
    return { maximized: getMainWindow()?.isMaximized() ?? false };
  });
}
