# 099 主畫面開啟滑鼠追蹤時，由 Polydesk 接管滾輪捲動

- 背景：使用者回報同事在 Claude 分頁中終端機完全無法向上捲動。實測確認病因：TUI 開啟滑鼠追蹤（`?1003`）後，xterm 會把滾輪事件當成滑鼠回報送給程式而不捲 scrollback，而 Claude／Codex 並不使用滾輪，滾輪等同消失；xterm 亦未實作 Shift 逃生口，實測 Shift+滾輪同樣捲 0 行，使用者沒有任何回看歷史的方法。此症狀早於 `terminal-scroll-follow.spec.ts` 檔頭被記錄，但當時只修了「輸出時 viewport 被凍住」的另一半。
- 決定：以**畫面模式**為判準接管滾輪——主畫面（normal buffer，程式把輸出印在有 scrollback 的緩衝區，如 Claude／Codex）且滑鼠追蹤開啟時，由 Polydesk 捲動終端機自身 scrollback 並不再回報給程式；替代畫面（alternate buffer，vim／htop 這類全螢幕接管、本無 scrollback）維持原樣送給程式。滑鼠追蹤未開啟時完全交還 xterm，原生手感不變。捲動量沿用 xterm 的像素模型（deltaY ÷ 實際列高），避免同一終端機在開啟 TUI 前後滾輪速度不一致。
- 原因：使用者在主畫面型 TUI 中的實際需求是回看歷史，而該類 TUI 並不消費滾輪，現行行為等於讓滾輪白白消失。以畫面模式判斷可自動涵蓋兩種情境、使用者無需學習任何按鍵；相對地「只補 Shift 逃生口」需要使用者事先知道有此按鍵——回報者正是因為不知道才回報。實作全程使用 xterm 公開 API（`attachCustomWheelEventHandler`、`modes.mouseTrackingMode`、`buffer.active.type`），未觸及私有內部，避免 xterm 升版即失效。
- 證據：使用者於彈窗選擇「依畫面模式自動判斷（推薦）」。實測（`e2e/terminal-tui-wheel-scroll.spec.ts`，真實滑鼠一格 deltaY 120）——修正前：未開滑鼠追蹤可捲、開啟後滾輪捲 0 行、Shift+滾輪亦為 0 行；修正後：開啟滑鼠追蹤時捲 6 行、Shift+滾輪 6 行。回歸：`terminal-rightclick-tui`、`terminal-scroll-follow`、`terminal` 三個既有 e2e 全綠。
