import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// 註：Monaco worker / MonacoEnvironment 由編輯器 task (F-4) 設定，本骨架不引入。

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
