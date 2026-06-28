// Polydesk main 入口：單一實例 + 安全基線 BrowserWindow + CSP + 狀態持久化 + perf 埋點。

import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { join } from 'node:path';
import { StateStore } from './store/StateStore';
import { registerIpcHandlers, type MainServices } from './ipc/router';
import { setMainWindow, emit } from './ipc/broadcast';
import { mark, measure } from '../shared/perf';
import { APP_NAME, STATE_FILE_NAME } from '../shared/constants';

mark('main:start'); // 冷啟動量測起點（REQ-PERF-001）

// 測試/可攜：允許以 env 覆寫 userData 目錄（E2E 隔離狀態、不污染真實設定）。
const userDataOverride = process.env['POLYDESK_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let services: MainServices;

function stateFilePath(): string {
  return join(app.getPath('userData'), STATE_FILE_NAME);
}

/** 設定 CSP 回應標頭（REQ-SEC-001）。dev 放寬以容 Vite HMR；prod 嚴設。 */
function applyContentSecurityPolicy(): void {
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws://localhost:* http://localhost:*; worker-src 'self' blob:;"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self';";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });
}

function createWindow(): void {
  const bounds = store.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0a0a0a',
    // 無框：標題列/選單/視窗鈕全由 renderer 自畫（深色一致）。仍可調整大小。
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  setMainWindow(mainWindow);

  // 最大化狀態變動 → 推給自訂標題列同步 max/restore 圖示（OS 快捷鍵/雙擊也會觸發）。
  mainWindow.on('maximize', () => emit('window:maximizedChange', { maximized: true }));
  mainWindow.on('unmaximize', () => emit('window:maximizedChange', { maximized: false }));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mark('window:interactive');
    const coldMs = measure('coldStart', 'main:start', 'window:interactive');
    // eslint-disable-next-line no-console
    console.log(`[Polydesk] 冷啟動至可互動：${coldMs.toFixed(1)} ms`);
  });

  // 外開連結一律拒絕 app 內導航，改丟系統瀏覽器（REQ-SEC-001）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // 限制 will-navigate：dev 只允許導航回 renderer URL，prod 一律擋
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (isDev && rendererUrl && url.startsWith(rendererUrl)) return;
    event.preventDefault();
  });

  // 視窗位置/大小持久化（REQ-PERSIST-003）
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.setWindowBounds(mainWindow.getBounds());
    }
  });
  mainWindow.on('closed', () => {
    setMainWindow(null);
    mainWindow = null;
  });

  if (isDev) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// 單一實例（REQ-PERSIST-002）：第二實例把現有視窗帶到前景。
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // 無框：移除預設原生 File/Edit 選單列（改由自訂標題列提供）
    store = new StateStore(stateFilePath());
    store.load();
    applyContentSecurityPolicy();
    services = registerIpcHandlers(store, app.getPath('userData'));
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // 結束前完整 teardown 所有工作區執行中程序/監看（避免殭屍程序，REQ-WS-009）。
  app.on('before-quit', () => {
    if (!services) return;
    services.monitor.stop(); // 先停輪詢，避免關閉中再起一次 probe
    for (const w of services.workspaces.list()) void services.lifecycle.teardown(w.id);
  });
}
