import { shell, type IpcMain } from 'electron';
import { mkdirSync } from 'node:fs';
import type { InvokeRes } from '../../shared/ipc';
import { diagnosticsRoot } from './diagnosticsLog';

/** 說明選單入口：只開啟固定的 userData 根目錄（含 logs/ 與 Crashpad/）（不存在先建立），不接受 renderer 指定路徑。 */
export function registerDiagnosticsHandlers(ipc: IpcMain): void {
  ipc.handle('app:openDiagnosticsDir', async (): Promise<InvokeRes<'app:openDiagnosticsDir'>> => {
    try {
      const dir = diagnosticsRoot();
      mkdirSync(dir, { recursive: true });
      return (await shell.openPath(dir)) === '' ? { opened: true } : { error: 'open-failed' };
    } catch {
      return { error: 'open-failed' };
    }
  });
}
