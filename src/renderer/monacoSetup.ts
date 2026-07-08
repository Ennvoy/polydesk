// Monaco worker 環境（整合接縫，design (j)、REQ-PERF-003）：Vite `?worker` import +
// self.MonacoEnvironment.getWorker，避免 fallback main thread 拖慢；CSP 已允許 worker-src blob:。
// Editor（F-4）與 SourceControl diff（F-7）皆 `import '../monacoSetup'` 一次設定，避免各自為政衝突。

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
// monaco-editor 0.55 standalone 漏註冊 productService；clipboard Paste 命令（右鍵選單/命令面板）
// 進場即 accessor.get(IProductService) 拋 unknown service，且選單路徑的錯誤被 action runner 吞掉，
// 表現為「點貼上沒反應、無任何錯誤」（upstream bug）。搶在 StandaloneServices 初始化（首次
// editor.create）前註冊最小 stub；quality='stable' 同時讓 paste 實作跳過 telemetry 分支。
// @ts-expect-error monaco 深路徑模組無型別宣告
import { registerSingleton } from 'monaco-editor/esm/vs/platform/instantiation/common/extensions.js';
// @ts-expect-error monaco 深路徑模組無型別宣告
import { IProductService } from 'monaco-editor/esm/vs/platform/product/common/productService.js';

class ProductServiceStub {
  readonly quality = 'stable';
}
registerSingleton(IProductService, ProductServiceStub, 1 /* InstantiationType.Delayed */);

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
