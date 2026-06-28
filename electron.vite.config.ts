import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite 慣例：main = src/main/index.ts、preload = src/preload/index.ts、
// renderer root = src/renderer（index.html 在其中）。輸出至 out/{main,preload,renderer}。
// preserveSymlinks：專案實體路徑含中文（…\我的終端機），開發/驗證一律從 ASCII
// junction（C:\polydesk-dev）執行；保留 symlink 路徑避免 Vite realpath 回 unicode 路徑
// 造成 loadAndTransform 失敗（見 decision ENV-JUNCTION）。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { preserveSymlinks: true },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { preserveSymlinks: true },
  },
  renderer: {
    plugins: [react()],
    resolve: { preserveSymlinks: true },
  },
});
