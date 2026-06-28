// Feature 註冊聚合器（整合接縫）：各 feature 在自己的模組 registerPanel(...)，
// 由本檔以 side-effect import 匯入，於 app bootstrap（main.tsx）時執行一次。
// 波次整合時在此加一行 import；features 不碰 panelRegistry/DockLayout（單向依賴）。

// Wave 2/3 features 將在此登錄，例：
// import './components/Explorer';        // F-2 → registerPanel('view:explorer', ...)
// import './components/Editor';          // F-4 → registerPanel('editor', ...)
// import './components/Terminal';        // F-3 → registerPanel('terminal', ...)
// import './components/Search';          // F-6 → registerPanel('view:search', ...)
// import './components/SourceControl';   // F-7 → registerPanel('view:scm', ...)

export function registerAllFeatures(): void {
  // side-effect imports 已於模組頂層執行；此函式僅作為明確 bootstrap 進入點。
}
