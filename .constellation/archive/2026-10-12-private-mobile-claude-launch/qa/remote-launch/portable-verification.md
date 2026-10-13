# Polydesk v0.40.0 交付驗證

2026-10-13 交付 portable，對應產品提交 `42571ba`；96,183,549 bytes，SHA-256 `1C84D82F9A4508164EBAE1D19E49B90E0A6AE8EBBF370904FD1471423B56D88F`。來源與交付副本的大小、雜湊一致。實際 EXE 隔離啟動確認 v0.40.0、遠端預設關閉、renderer 無 Node API、忽略 E2E gateway；缺少 Tailscale 時顯示原因、停用且無 loopback 監聽。QR 依賴與 native PTY 隨包，正常退出後自己的解壓目錄已清理。

20 項正式指令全部通過：88 個單元／整合檔案、723 項通過；Electron 128 項通過、3 項條件略過。既有冷啟動 REQ-PERF-001 豁免保留；18 秒／10% 背景 CPU 原門檻通過。

配對期限支援 7 天、30 天及永久；每位同事需在自己的電腦與手機完成私人 Tailscale、電腦配對批准及工作區授權。啟動成功只代表真分頁與固定命令送出，Claude 登入／就緒仍需桌面確認。

真 Tailscale 帳號及實體手機 4G 未實測；本機 HTTP／Electron 證據不代替該外部鏈路。

相關原始配對圖與 raw-evidence 留在本機，不隨 Git 或 EXE 分享。完整簽章：`ee8bc37f6d3110e2718b825ec4b236db6c7b53bc6703eb23c226a449b799c80a`。

全量驗證先於 launcher 清理修正；修正另經 typecheck、兩檔四測試、真 NSIS 三情境與重建 EXE 三次正常關閉驗證。Authenticode 狀態：NotSigned；SHA-256 用於比對成品完整性。
