import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

// NSIS 解壓到每次啟動專屬的 $PLUGINSDIR/app；訊號只寫回本次執行檔所在目錄。
// 只在正式 portable 環境使用，沒有 renderer IPC 或由外部指定的檔案路徑。
export function markPortableStartupReady(): void {
  if (!app.isPackaged || !process.env['PORTABLE_EXECUTABLE_FILE']) return;
  try {
    writeFileSync(join(dirname(process.execPath), '.polydesk-startup-ready'), '', { flag: 'wx' });
  } catch (error) {
    // 重複握手可忽略；其他失敗由 NSIS 的啟動逾時保底回饋。
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      console.error('[Polydesk] 無法通知 portable 開啟畫面關閉', error);
    }
  }
}
