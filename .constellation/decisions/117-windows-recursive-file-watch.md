# 117 Windows 工作區改用單一原生遞迴檔案監看器

- 背景：使用者回報 Polydesk 偶爾整個視窗無回應且沒有固定時機。v0.34.0 執行中的主程序持有約 2.2 萬個控制代碼，Microsoft Sysinternals Handle 分類顯示約 2.1 萬個為檔案控制代碼；單一 `.next/dev/cache/turbopack/v16.2.10` 目錄重複出現近 5,000 次。Chokidar 在 Windows 對大量檔案各建監看，造成控制代碼隨工作區內容增長；主程序曾短暫被 Windows 判為無回應，但此證據不能排除其他卡頓原因。
- 決定：Windows 每個工作區以一次 `fs.watch(root, { recursive: true })` 接收變更；保留路徑分段忽略、真實父路徑 containment、寫入穩定窗、事件洪水回退根目錄對帳、關閉時釋放。`.next` 僅從檔案監看排除。非 Windows 或原生監看無法建立時保留 chokidar。
- 原因：已確認控制代碼壓力集中於檔案監看；原生遞迴監看使控制代碼成本由檔案數量轉為工作區數量，不改變檔案總管、編輯器外部更新與 SCM 的 IPC 契約。
- 驗證：600 檔 Windows 監看新增控制代碼少於 50，新增、修改、刪除、junction 逃逸、忽略目錄與洪水案例通過；真 Electron 外部改檔、檔案總管與 SCM 5 案通過。實際長時間無回應頻率需在新版重新啟動後持續觀察。
