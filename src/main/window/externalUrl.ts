import { shell, type IpcMain } from 'electron';
import type { InvokeRes } from '../../shared/ipc';
import { normalizeExternalHttpUrl } from '../../shared/externalUrl';

/** renderer 只能透過固定 IPC 要求外開 URL；main 複驗 HTTP(S) 白名單後才交給系統瀏覽器。 */
export function registerExternalUrlHandlers(ipc: IpcMain): void {
  ipc.handle('app:openExternalUrl', async (_event, req: unknown): Promise<InvokeRes<'app:openExternalUrl'>> => {
    const raw = typeof req === 'object' && req !== null && 'url' in req ? (req as { url?: unknown }).url : undefined;
    const url = typeof raw === 'string' ? normalizeExternalHttpUrl(raw) : null;
    if (!url) return { error: 'invalid-url' };
    try {
      await shell.openExternal(url);
      return { opened: true };
    } catch {
      return { error: 'open-failed' };
    }
  });
}
