// Polydesk main 入口：單一實例 + 安全基線 BrowserWindow + CSP + 狀態持久化 + perf 埋點。

import { app, BrowserWindow, Menu, screen, session, shell } from 'electron';
import { join } from 'node:path';
import { StateStore } from './store/StateStore';
import { registerIpcHandlers, type MainServices } from './ipc/router';
import { checkForUpdatesOnStartup } from './update/AutoUpdater';
import { installClaudeStatusHooks } from './claude/statusHooks';
import { installStatuslineUsage } from './claude/statuslineUsage';
import { setMainWindow, emit } from './ipc/broadcast';
import { closeGate } from './window/windowControls';
import { mark, measure, getMeasures } from '../shared/perf';
import { APP_NAME, STATE_FILE_NAME } from '../shared/constants';
import type { WindowBounds } from '../shared/types';

mark('main:start'); // 冷啟動量測起點（REQ-PERF-001）
// 診斷 seam（X-1 perf harness 經 electronApp.evaluate 讀 main 埋點；非 IPC、不影響執行期）。
(globalThis as unknown as { __pdPerf?: unknown }).__pdPerf = { getMeasures };

// 測試/可攜：允許以 env 覆寫 userData 目錄（E2E 隔離狀態、不污染真實設定）。
const userDataOverride = process.env['POLYDESK_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

// REQ-SEC-001：dev 判定須與 app.isPackaged 交叉，確保打包正式版即使被帶 ELECTRON_RENDERER_URL 啟動，
// 也永遠走 prod 嚴格分支（嚴 CSP + 擋導航），不被外部 URL 接管殼。
const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL'];

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
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none';";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });
  // REQ-SEC-001：app 自有 UI 不需要 web 權限（地理位置/相機麥克風/通知…）→ 預設一律拒絕。
  // 唯一例外：自家主視窗的剪貼簿讀寫——Monaco 編輯器右鍵選單貼上走 navigator.clipboard.readText，
  // 全拒會讓它靜默失敗（同 explorer/scm 複製路徑失效的病因，見 1b01e21）。renderer 本就可經
  // clipboard IPC（clipboard:readText/writeText）讀寫剪貼簿，此放行不新增攻擊面。
  const isOwnClipboardPermission = (wc: Electron.WebContents | null, permission: string): boolean =>
    (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') &&
    wc !== null &&
    wc === mainWindow?.webContents;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(isOwnClipboardPermission(wc, perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => isOwnClipboardPermission(wc, perm));
}

/** 上次存的位置若已不在任何螢幕工作區內（外接螢幕拔除/解析度改變），丟掉 x/y 讓 Electron 置中，避免視窗開在螢幕外。 */
function ensureVisibleBounds(bounds: WindowBounds | undefined): WindowBounds | undefined {
  if (!bounds || bounds.x === undefined || bounds.y === undefined) return bounds;
  const { x, y, width, height } = bounds;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const ix = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
    const iy = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
    return ix >= 100 && iy >= 40; // 至少露出一塊抓得到標題列的角落才算「看得見」
  });
  return visible ? bounds : { width, height };
}

function createWindow(): void {
  closeGate.reset();
  const bounds = ensureVisibleBounds(store.get('windowBounds'));
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    show: false,
    icon: join(__dirname, '../../build/icon.ico'),
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
    console.log(`[Polydesk] cold-start to interactive: ${coldMs.toFixed(1)} ms`);
  });

  // 外開連結一律拒絕 app 內導航，改丟系統瀏覽器（REQ-SEC-001）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // 限制導航：dev 只允許回 renderer URL，prod 一律擋。will-redirect 一併綁（重導鏈不觸發 will-navigate）。
  const blockNavigation = (event: Electron.Event, url: string): void => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (isDev && rendererUrl && url.startsWith(rendererUrl)) return;
    event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', blockNavigation);
  mainWindow.webContents.on('will-redirect', blockNavigation);

  // 視窗位置/大小持久化（REQ-PERSIST-003）＋ app 關閉攔截（REQ-TERM-007 app 層）：
  // 仍有 alive 終端機（可能跑著 claude / 建置 / 伺服器）→ 擋下這次 close、推 app:closeRequest
  // 讓 renderer 彈確認，核可（window:confirmClose）才放行。renderer 掛掉時不攔（否則永遠關不掉）。
  mainWindow.on('close', (e) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.setWindowBounds(mainWindow.getBounds());
    }
    if (closeGate.confirmed() || !services) return;
    const wsIds = services.workspaces
      .list()
      .filter((w) => services.pty.hasRunningProcesses(w.id))
      .map((w) => w.id);
    if (wsIds.length === 0) return;
    const wc = mainWindow?.webContents;
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return;
    e.preventDefault();
    emit('app:closeRequest', { wsIds });
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

  // Windows 通知點擊回喚靠 AppUserModelID 路由；不設的話 toast 來源名稱錯誤、點擊回喚不可靠。
  app.setAppUserModelId('com.polydesk.app');

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // 無框：移除預設原生 File/Edit 選單列（改由自訂標題列提供）
    store = new StateStore(stateFilePath());
    store.load();
    applyContentSecurityPolicy();
    services = registerIpcHandlers(store, app.getPath('userData'));
    createWindow();
    // F-8：注入 Claude Code 狀態 hooks（merge-safe、冪等、壞檔不覆寫）→ 精準三態靠 hook 真實信號。
    void installClaudeStatusHooks().catch(() => undefined);
    void installStatuslineUsage().catch(() => undefined);
    // REQ-NFR-004：啟動觸發一次更新檢查（electron-updater 不自輪詢）；僅打包正式版（dev 無 provider）。
    if (app.isPackaged) checkForUpdatesOnStartup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // 結束前完整 teardown 所有工作區執行中程序/監看（避免殭屍程序，REQ-WS-009）。
  // 必須「等 teardown 真的做完」才退出：原本射後不理，taskkill 常來不及跑 → PTY shell 變孤兒、
  // ConPTY 原生 handle 未釋放 → 打包版整棵程序樹卡在工作管理員。故攔下第一次 quit、await 全部
  // teardown（保底逾時，清理卡死也不留殭屍）後 app.exit(0) 硬退（quit 事件仍會發，updater 掛勾不受影響）。
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    void shutdownAndExit();
  });
}

const SHUTDOWN_TIMEOUT_MS = 3_000;

async function shutdownAndExit(): Promise<void> {
  try {
    if (services) {
      services.monitor.stop(); // 先停輪詢，避免關閉中再起一次 probe
      const teardownAll = (async () => {
        for (const w of services.workspaces.list()) await services.lifecycle.teardown(w.id);
      })();
      await Promise.race([teardownAll, new Promise<void>((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS))]);
    }
  } finally {
    app.exit(0);
  }
}
