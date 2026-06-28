import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';
import { appStore } from './state/appStore';
import { registerAllFeatures } from './features';

// 註：Monaco worker / MonacoEnvironment 由編輯器 task (F-4) 設定。

registerAllFeatures();
// 啟動即載入工作區清單（lazy 實體化：被點到才 hydrate）。
void appStore.loadWorkspaces();

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
