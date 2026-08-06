# 008 Codex 對話軸定位方式

## 背景

Codex rollout 能提供角色化的使用者文字，但官方 CLI 沒有直接跳到指定舊回合的快捷操作；現有 Claude 的 Ctrl+O 定位方式不可套用，因為 Ctrl+O 在 Codex 代表複製最新回覆。

## 決定

Codex 對話軸將 rollout 中的使用者文字與目前 xterm scrollback 配對；只顯示能定位到終端機原始提問位置的節點，點擊後捲到該行。已離開 scrollback 或無法可靠配對的舊提問不顯示。

## 原因

這能保留真正可用的點擊導航，又不會產生看得到但點擊後無法定位的假節點，也不需猜測或誤用 Codex 快捷鍵。

## 證據

訪談題目：「Codex 的提問節點點下去時，要怎麼處理？」使用者選擇選項 1：「對應終端機裡的原始提問位置（推薦）」。當時依據為本機實際 rollout 有結構化 user message，且目前 Codex 官方手冊只記載 prompt history、編輯上一則訊息與 raw scrollback，未提供跳到指定舊回合的操作。
