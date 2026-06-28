import { defineConfig } from '@playwright/test';

// E2E 以 Playwright 的 _electron 直接啟動已 build 的 Electron app（out/main/index.js），
// 真實點擊 / 真實 IPC / 真實 fs / 真實 git，不 mock。無需下載瀏覽器。
// 一律從 ASCII junction（C:\polydesk-dev）執行（見 decision ENV-JUNCTION）。
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
