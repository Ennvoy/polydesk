import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite 慣例：main = src/main/index.ts、preload = src/preload/index.ts、
// renderer root = src/renderer（index.html 在其中）。輸出至 out/{main,preload,renderer}。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
