// X-4 REQ-SEC-001：renderer 安全基線「原始碼不變量」。讀 main/preload 原始碼斷言關鍵硬化在線，
// 任何人把旗標改成不安全值即紅（確定性回歸守門，不需啟動 app）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');
const indexSrc = read('src/main/index.ts');
const preloadSrc = read('src/preload/index.ts');

describe('BrowserWindow 安全旗標', () => {
  it('contextIsolation/sandbox/webSecurity 開、nodeIntegration/allowRunningInsecureContent 關', () => {
    expect(indexSrc).toMatch(/contextIsolation:\s*true/);
    expect(indexSrc).toMatch(/sandbox:\s*true/);
    expect(indexSrc).toMatch(/webSecurity:\s*true/);
    expect(indexSrc).toMatch(/nodeIntegration:\s*false/);
    expect(indexSrc).toMatch(/allowRunningInsecureContent:\s*false/);
  });
});

describe('prod CSP', () => {
  // 取 applyContentSecurityPolicy 的 prod 分支字串（isDev 三元的 false 側）。
  const prod = indexSrc.split("? ")[1]?.split(': "')[1]?.split('";')[0] ?? indexSrc;
  it("含 default-src 'self' 與 script-src 'self'", () => {
    expect(prod).toContain("default-src 'self'");
    expect(prod).toContain("script-src 'self'");
  });
  it("prod CSP 不含 unsafe-eval；script-src 不含 unsafe-inline", () => {
    expect(prod).not.toContain("'unsafe-eval'");
    // script-src 後到下一個 ; 之間不得有 unsafe-inline
    const scriptSrc = prod.split('script-src')[1]?.split(';')[0] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
  it('含不從 default-src 繼承的硬化指令', () => {
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("object-src 'none'");
  });
});

describe('權限與導航守門', () => {
  it('註冊 setPermissionRequestHandler 並以 false 拒絕', () => {
    expect(indexSrc).toMatch(/setPermissionRequestHandler\([\s\S]*?cb\(false\)/);
    expect(indexSrc).toMatch(/setPermissionCheckHandler\(\(\)\s*=>\s*false\)/);
  });
  it('外開連結 deny + 僅 https? 丟系統瀏覽器；will-navigate 與 will-redirect 皆守門', () => {
    expect(indexSrc).toMatch(/setWindowOpenHandler/);
    expect(indexSrc).toMatch(/action:\s*'deny'/);
    expect(indexSrc).toMatch(/shell\.openExternal/);
    expect(indexSrc).toContain("on('will-navigate'");
    expect(indexSrc).toContain("on('will-redirect'");
  });
  it('isDev 與 app.isPackaged 交叉（打包版永走 prod 嚴格分支）', () => {
    expect(indexSrc).toMatch(/!app\.isPackaged\s*&&/);
  });
});

describe('preload 暴露面', () => {
  it('只用單一 polydesk namespace；不直接外洩 ipcRenderer', () => {
    const exposeCalls = preloadSrc.match(/exposeInMainWorld\(/g) ?? [];
    expect(exposeCalls.length).toBe(1);
    expect(preloadSrc).toContain("exposeInMainWorld('polydesk'");
    // 不得把 ipcRenderer 整個物件當 api 暴露
    expect(preloadSrc).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer\s*\)/);
  });
});
