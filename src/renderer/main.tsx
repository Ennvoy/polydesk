import React from 'react';
import { createRoot } from 'react-dom/client';
// 打包的開源等寬字型（免安裝即選，SettingsPanel 提供切換）。400 regular + 700 bold（終端機粗體）。
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/700.css';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';
import { TerminalFontProvider } from './theme/TerminalFontProvider';
import { appStore } from './state/appStore';
import { registerAllFeatures } from './features';
import { getMeasures, clearPerf } from '../shared/perf';

// 註：Monaco worker / MonacoEnvironment 由編輯器 task (F-4) 設定。

// 診斷 seam（X-1 perf harness 經 page.evaluate 讀 renderer 埋點；不影響執行期）。
(window as unknown as { __pdPerf?: unknown }).__pdPerf = { getMeasures, clearPerf };

registerAllFeatures();
// 啟動即載入工作區清單（lazy 實體化：被點到才 hydrate）。
void appStore.loadWorkspaces();

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <ThemeProvider>
        <TerminalFontProvider>
          <App />
        </TerminalFontProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
