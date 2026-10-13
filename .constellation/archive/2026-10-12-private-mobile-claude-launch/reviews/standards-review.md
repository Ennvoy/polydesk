# Standards 整批審查

基準 baaae67；審查工作樹 tracked diff 與新產品檔，未讀其他報告／本輪決議，未跑全量測試。

- P2：外部啟用 Funnel 後，監測會停用遠端，但 `TailscaleGateway.ts:47–50` 先清 owned，再套用拒絕 Funnel 的 safe，導致撤銷拋錯；`RemoteService.ts:132` 吞錯。自己的 8443 代理仍留著，後續停用亦無法清理，其他程序之後佔用 49387 時會沿用該轉送。記憶體載入實際源碼＋mock CLI 重現：`serves=true, owned=false, offCalls=0`。撤銷應單獨核對仍屬自己的 endpoint，成功 off 後才清 ownership。

原「先建 Serve 再佔埠、啟用失敗未清理」已修：`RemoteService.ts:108–121` 先佔埠並清理；真 loopback 衝突實驗回傳停用、代理未啟用。未實測真 Tailscale。

發現數：1 個未結案、1 個已修；目前最嚴重 P2。

複審：P2 resolved。`TailscaleGateway.ts:71–77` 實測 off 失敗保留 owned、Funnel 下重試成功、replacement 不 off；remote 2 檔 18 測試通過。

- P1 unresolved：同回合 enable→disable，在 listen 完成前 close，取消 `RemoteService.ts:118` 的 callback；`:152` 永等 enableFinished，重啟遠端與 app shutdown 卡住。真來源＋loopback 實驗 500ms 後兩 Promise 未完成，gateway 呼叫 0。須讓 listen Promise 在取消時也收斂。

lastship 基準 `545cd865629c9ab89d1855b8bab5755c2b24e53c` 可解析、tracked diff 非空（107 檔）；已補看既有發布的 startup／PTY／SCM IPC／worktree 串接，未重審舊票。

最新發現數：1 個未結案、2 個已修；最嚴重 P1。

再次複審：P1 resolved。原真來源＋port0 loopback 實驗：同 tick 取消後，1 秒內兩 Promise 均完成、gateway enable 0 次、listener 0；接著正常 reenable／disable 成功。remote 2 檔 19 測試通過（含同 tick 回歸）。

最終發現數：0 個未結案、3 個已修；目前無嚴重度待處理。

最後聚焦審查：`RemoteService.ts:263–289` 即時拒絕新並發、先回既存操作並核對 generation，未見新增漏洞。獨立重跑新增真 HTTP 回歸：2 passed（12 skipped），涵蓋容量與跨代取消。結論維持 0 未結案。

SHIP 複審：1500s 合理；40 斷言、單步時限不變；5 段 timer；新版 GUI 待驗。

web-link 工具複審：未放寬語義。真 buffer 逐格定位且獨立驗證前綴 7 格；真 mousemove 重觸 hover 符合已安裝 xterm resize／cell-change 行為。靜態比較白名單與點擊後半段相同，write／Ctrl click 各一次、hover 5s、未偽造 currentLink。新版 GUI 與正式全量待驗；未新增產品 finding。

SHIP branch 候選 pending：`SourceControlPanel.tsx:751–771` 每 250ms 無上限發 status，`GitService.ts:1271` 將它們排入串行 claims queue，`CleanupService.ts:475` 每次 await 真 Git common-dir。平均處理超過 250ms 即累積；`:1181` 最後 status 等隊尾，`:678` busy 尚未釋放。靜態機制可解釋 ref 已刪但 refresh 停用；未由本審查獨立實測當次根因。最小 single-flight 須保留最後真 status、安全 queue、終態與 current/generation 防舊回包，stop/error 不再堆積；待實作及回歸複核。

polling fix 複審無新 finding；actual GUI pending。helper 在 request settle 後才再排程，stop/current/generation 防晚回包，拒絕仍可下一輪；unmount/換工作區停止，原最後 status、busy 與 main claims queue 未改。7 回歸的舊 baseline 有 3 red/4 pass；未自行執行新版測試。JSON 摘要確認舊診斷 205 status、max outstanding 138，execute 50.983s 已 closed，最後 status 又等 68.384s；此證據不代表新 fix 已通過 GUI。原 branch 逐步斷言及 30/60/120s 上限保留。

branch budget／backlog resolved：已讀 `branch-scoped-after-polling-fix.txt/json`，原完整首案例 1 passed、exit 0、372770ms（6.2m），remote 段 99996ms，原 refresh 120s 斷言通過。再次核對 catch、cleanupApi done/fail、delete/resume 回包皆有 isCurrent 防護；single-flight 停止及最後真 status／claims 安全串行維持。此結案僅限 branch 兩項；web-link 修後重跑與正式 full 結果仍待驗，不宣稱 full PASS。

web-link finding resolved：已讀 `web-link-scoped-after-adjustment.txt/json`，修後原案例 repeat-each=3、1 worker，3 passed（31.5s）、exit 0；工具總時長 32961ms。最新 spec 仍真 hover 5s、前綴 7 格、一次 write／Ctrl click，普通點擊及 HTTP/file 白名單斷言保留。

目前 0 unresolved。正式 full pending 僅為尚待完成的出貨驗證工作，不是未結案 finding；本報告不宣稱 full PASS。

CPU P2 unresolved：10 空工作區、完全無 PTY，原 `ClaudeStatusMonitor.ts:217–261` 仍掃程序、讀三來源並反覆 list→existsSync/statSync；徒耗 main CPU。root 實測 formal 14.322%、原案 scoped 10.244%，皆超過原 18s／10% 門檻；profile 的 26.1278% 僅診斷值。無 PTY→idle 原已有語義，快照＋逐工具 apply idle 的最小方案未見必然回歸；活躍路徑須保留最新 pidsOf、scan／force／fallback。尚未讀到修後 diff 或 green，不能宣稱 resolved。

目前 1 unresolved，最嚴重 P2；前 9 件 resolved 維持，正式 full 尚未通過。

CPU fix 靜態複審：`ClaudeStatusMonitor.ts:218–225` 全無 PTY 才逐工具 apply idle 早退；有 PTY 原 scan／read／force／fallback 與 await 後最新 pidsOf 保留，工作區快照消除逐 session 的磁碟檢查。未見新增具體功能漏洞。已讀紅綠 raw：舊版 3 failed／12 passed（空 PTY 仍讀來源、list 32 次），新版 monitor 5 檔 42 passed，包含三工具 idle、再開 PTY、混合工作區及晚回包關閉競態。原 18s／10% CPU 實跑待驗，仍 1 unresolved；未自行跑測試或 GUI。

CPU finding resolved：已讀 `idle-cpu-after-fix.txt/json`，原案例 1 passed（33.5s）、exit 0；10 工作區／18000ms，main CPU 0.8% < 原 10% 門檻。`e2e/perf.spec.ts` 相對正式 release baseline 及工作樹皆零 diff；最新 `ClaudeStatusMonitor.ts:253–257` 於 await 後重新 pidsOf 判定存活，未快取 PID。原 scan／來源／fallback 活躍語義保留，未見新 finding。

目前 0 unresolved；前 9 件及本次 CPU 均 resolved。正式全量尚未完成，不能宣稱 full PASS；本審查未啟 GUI 或測試。

2026-10-13 portable 清理複審：實際模板尾段與真 NSIS 紅綠 probe 一致；只對 own INSTDIR 有界重試，R6 保留、耗盡 exit 1，無須追加產品修改。真鎖持有者尚未確認。先前全量簽章不涵蓋此 launcher 修正；新版 EXE 正常退出與清理仍待實際重建 smoke，不重跑不受影響的 full20。未啟 GUI、測試或改程式。
