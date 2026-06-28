// 自動更新（X-2，REQ-NFR-004）：electron-updater generic provider 輪詢 latest.yml 差量更新。
// dev / 無更新伺服器時優雅降級（不崩潰）；進度經 update:progress 事件推 renderer。

import { autoUpdater } from 'electron-updater';
import type { IpcMain } from 'electron';
import { emit } from '../ipc/broadcast';
import type { InvokeRes } from '../../shared/ipc';

export function registerUpdateHandlers(ipc: IpcMain): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => emit('update:progress', { percent: 0, state: 'checking' }));
  autoUpdater.on('download-progress', (p: { percent: number }) =>
    emit('update:progress', { percent: Math.round(p.percent), state: 'downloading' }),
  );
  autoUpdater.on('update-downloaded', () => emit('update:progress', { percent: 100, state: 'ready' }));
  autoUpdater.on('error', () => {
    /* dev / 無更新伺服器 / 網路問題：不崩潰、不擾使用者（手動 check 會回 available:false） */
  });

  ipc.handle('update:check', async (): Promise<InvokeRes<'update:check'>> => {
    try {
      const r = await autoUpdater.checkForUpdates();
      const latest = r?.updateInfo?.version;
      const current = autoUpdater.currentVersion?.version;
      return { available: !!latest && latest !== current, version: latest };
    } catch {
      return { available: false }; // 未打包 / 無 provider / 網路 → 不崩潰
    }
  });

  ipc.handle('update:install', (): InvokeRes<'update:install'> => {
    try {
      autoUpdater.quitAndInstall();
    } catch {
      /* 無已下載更新時 no-op */
    }
    return { ok: true } as const;
  });
}
