// Monaco worker 環境（整合接縫，design (j)、REQ-PERF-003）：Vite `?worker` import +
// self.MonacoEnvironment.getWorker，避免 fallback main thread 拖慢；CSP 已允許 worker-src blob:。
// Editor（F-4）與 SourceControl diff（F-7）皆 `import '../monacoSetup'` 一次設定，避免各自為政衝突。

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

declare global {
  // eslint-disable-next-line no-var
  var MonacoEnvironment: { getWorker: (workerId: string, label: string) => Worker; globalAPI?: boolean } | undefined;
}

self.MonacoEnvironment = {
  globalAPI: true,
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      default:
        return new editorWorker();
    }
  },
};

export {};
