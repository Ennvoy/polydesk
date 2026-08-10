import { BrowserWindow } from 'electron';

const SPLASH_DELAY_MS = 250;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}

function shell(body: string): string {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:"Segoe UI",Arial,sans-serif;background:#141414;color:#ededed;border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center}.card{width:100%;height:100%;padding:30px 34px;display:flex;flex-direction:column;justify-content:space-between;background:radial-gradient(circle at 18% 0%,rgba(0,112,243,.18),transparent 44%),#141414}.brand{display:flex;align-items:center;gap:10px}.mark{width:28px;height:28px;color:#3291ff}.name{font-size:18px;font-weight:650;letter-spacing:.01em}.version{font-size:10px;color:#6b6b6b;letter-spacing:.12em;text-transform:uppercase}.status{display:flex;align-items:center;gap:10px;color:#a1a1a1;font-size:12px}.spinner{width:15px;height:15px;border:2px solid rgba(255,255,255,.12);border-top-color:#3291ff;border-radius:50%;animation:spin .8s linear infinite}.error{color:#ededed;font-size:14px;font-weight:600;margin:0 0 7px}.detail{color:#808080;font-size:11px;line-height:1.45;max-height:48px;overflow:hidden}.actions{display:flex;gap:8px;margin-top:15px}.actions a{display:inline-flex;align-items:center;justify-content:center;min-width:76px;padding:7px 12px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;color:#ededed;border:1px solid rgba(255,255,255,.12);background:#1c1c1c}.actions a.primary{color:#fff;background:#0070f3;border-color:#0070f3}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none;border-color:#3291ff}}
  </style></head><body>${body}</body></html>`;
}

function loadingHtml(): string {
  return shell(`<main class="card"><div class="brand"><svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,20 22,72 78,72" fill="currentColor" opacity=".95"/><polygon points="24,28 80,44 44,80" fill="currentColor" opacity=".6"/><polygon points="76,30 56,80 20,50" fill="currentColor" opacity=".45"/></svg><div><div class="name">Polydesk</div><div class="version">Workspace · Editor · Terminal</div></div></div><div class="status"><span class="spinner"></span><span>正在準備工作區…</span></div></main>`);
}

function failureHtml(reason: string): string {
  return shell(`<main class="card"><div class="brand"><svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,20 22,72 78,72" fill="currentColor" opacity=".95"/><polygon points="24,28 80,44 44,80" fill="currentColor" opacity=".6"/><polygon points="76,30 56,80 20,50" fill="currentColor" opacity=".45"/></svg><div><div class="name">Polydesk</div><div class="version">Startup interrupted</div></div></div><div><p class="error">無法完成啟動</p><div class="detail">${escapeHtml(reason || '主畫面載入失敗，請重試或退出程式。')}</div><div class="actions"><a class="primary" href="polydesk-splash://retry">重試</a><a href="polydesk-splash://exit">退出</a></div></div></main>`);
}

function asDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export interface SplashController {
  complete(): void;
  fail(reason: string): void;
  retrying(): void;
}

export function createSplashWindow(actions: { retry: () => void; exit: () => void }): SplashController {
  const win = new BrowserWindow({
    width: 420,
    height: 230,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#141414',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  let closingProgrammatically = false;
  let done = false;
  const showTimer = setTimeout(() => {
    if (!done && !win.isDestroyed()) {
      win.center();
      win.show();
    }
  }, SPLASH_DELAY_MS);

  void win.loadURL(asDataUrl(loadingHtml()));
  win.webContents.on('will-navigate', (event, url) => {
    if (url === 'polydesk-splash://retry') {
      event.preventDefault();
      actions.retry();
    } else if (url === 'polydesk-splash://exit') {
      event.preventDefault();
      closingProgrammatically = true;
      actions.exit();
    } else if (!url.startsWith('data:text/html')) {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', () => {
    if (!closingProgrammatically && !done) {
      closingProgrammatically = true;
      actions.exit();
    }
  });

  return {
    complete(): void {
      if (done) return;
      done = true;
      clearTimeout(showTimer);
      closingProgrammatically = true;
      if (!win.isDestroyed()) win.close();
    },
    fail(reason: string): void {
      if (done || win.isDestroyed()) return;
      clearTimeout(showTimer);
      void win.loadURL(asDataUrl(failureHtml(reason))).finally(() => {
        if (!done && !win.isDestroyed()) {
          win.center();
          win.show();
          win.focus();
        }
      });
    },
    retrying(): void {
      if (done || win.isDestroyed()) return;
      void win.loadURL(asDataUrl(loadingHtml())).finally(() => {
        if (!done && !win.isDestroyed()) win.show();
      });
    },
  };
}
