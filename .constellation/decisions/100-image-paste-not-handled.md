# 100 終端機圖片貼上：本輪不處理，維持現況

- 背景：使用者回報同事無法把圖片貼進 Claude CLI。實測釐清為三段獨立事實：(1) Polydesk 有正確把 Alt+V 送到 PTY（實測送出 `ESC v`），同事端 Claude 亦有回應「沒有圖片可以貼上」，故非按鍵傳遞問題；(2) Claude Code 在 Windows 讀不到原生點陣圖格式的剪貼簿圖片，屬上游已知問題；(3) Polydesk 自身另有一個確定缺口——`pasteFromClipboard` 只呼叫 `clipboard.readText()`，剪貼簿為圖片時回空字串，按鍵被 `attachCustomKeyEventHandler` 攔下後靜默丟棄，實測 PTY 收到 `[]`（零 byte）。
- 決定：**本輪不處理**，不實作圖片貼上、也不修補 Ctrl+V 靜默丟棄。使用者改以「將圖片存成檔案後拖放進終端機」的既有路徑處理。
- 原因：使用者評估後認為此需求不值得為它新增暫存檔管理與一條新的貼上分支；既有的拖放路徑已能達成相同目的。此決定不否認上述缺口存在，僅是不在此時投入。
- 證據：使用者原話「不修，請同事用拖放」與「圖片這個就先不處理了」。實測數據——`Alt+V → ["<ESC>v"]`；剪貼簿置入圖片後 `Ctrl+V → []`、置入文字後 `Ctrl+V → ["PDTEXT"]`；以 .NET `Clipboard.SetImage`（截圖工具路徑）置入原生點陣圖後，Electron 端 `availableFormats=["image/png"]`、`readText=""`、`readImage().isEmpty()=false`、可轉出 111 bytes PNG——即 Polydesk 具備讀取該格式的能力，日後若要實作可循「存 PNG 檔後貼入路徑」繞過上游問題。
