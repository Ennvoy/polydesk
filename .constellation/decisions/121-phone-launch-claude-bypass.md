# 121 手機操作新增 Claude bypass 分頁

## 背景

使用者希望從手機一次操作，讓 Polydesk 自動新增 Claude 分頁。現有 Claude bypass 按鈕會建立獨立終端機並執行固定啟動命令。

## 決定

手機操作必須在 Polydesk 新增真實 Claude 分頁，行為等同現有 Claude bypass 按鈕；不能以僅提供 Claude 遠端會話代替。

## 原因

使用者要求「就像我按了claude bypass按鈕一樣」。

## 證據

使用者原話：「就像我按了claude bypass按鈕一樣」。程式依據為 `src/renderer/components/Terminal/TerminalPanel.tsx:52` 的固定 Claude bypass 命令，以及同檔 `:179` 起的建立終端機與啟動流程。
