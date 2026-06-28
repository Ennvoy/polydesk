// Feature 註冊聚合器（整合接縫）：各 feature 在自己的模組 registerPanel(...)，
// 由本檔以 side-effect import 匯入，於 app bootstrap（main.tsx）時執行一次。
// 波次整合時在此加一行 import；features 不碰 panelRegistry/DockLayout（單向依賴）。

import './components/Explorer'; // F-2 → registerPanel('view:explorer', Explorer) + 訂閱 fs:change
import './components/Terminal'; // F-3 → registerPanel('terminal', TerminalPanel)
import './components/Editor'; // F-4 → monacoSetup + registerPanel('editor', EditorGroup)
import './components/Editor/lsp'; // F-5 → 全域 LSP provider + diagnostics + 缺件 toast
import './components/Search'; // F-6 → registerPanel('view:search', Search)
import './components/SourceControl'; // F-7 → monacoSetup + registerPanel('view:scm', SourceControlPanel)
// F-1 的 WorkspaceRail/EmptyWelcome/ClaudeStatusBadge 為 UI 元件（非 panel），由 App.tsx 直接渲染。
// F-8 Claude 監控為 main 端（emit claude:status）；F-10 dock 持久化在 layout/DockLayout。

export function registerAllFeatures(): void {
  // side-effect imports 已於模組頂層執行；此函式僅作為明確 bootstrap 進入點。
}
