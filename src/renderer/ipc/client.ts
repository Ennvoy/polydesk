// renderer 端封裝 window.polydesk（型別取自 shared 單一真相）。

import type { PolydeskApi } from '../../shared/ipc';

declare global {
  interface Window {
    polydesk: PolydeskApi;
  }
}

export const ipc: PolydeskApi = window.polydesk;
