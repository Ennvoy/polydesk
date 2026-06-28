import { defineConfig } from 'vitest/config';

export default defineConfig({
  // preserveSymlinks：專案實體在含中文的路徑（…\我的終端機），Vite 預設會 realpath
  // 把 ASCII junction（C:\polydesk-dev）解回中文路徑，導致 unicode URL 的 loadAndTransform
  // 失敗。保留 symlink 路徑 → 全程走 ASCII junction → 測試/轉譯一致可跑。
  resolve: { preserveSymlinks: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // 真實依賴測試（真 git / 真 node-pty / 真 fs）在 Windows 首跑較慢，放寬逐測 timeout。
    testTimeout: 25_000,
    hookTimeout: 25_000,
  },
});
