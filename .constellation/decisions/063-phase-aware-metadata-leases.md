# 063 分階段 metadata lease 與 Git 能力邊界

## 背景

branch ref 以 `update-ref` 刪除時可能正常追加 old-to-zero reflog，若仍要求確認時 digest 原樣不變，會把自己的合法更新誤判成外部競態。

## 決定

ref CAS 必須使用含 cleanup generation 的 reflog message。journal 的 reflog lease 分為 D0（確認時）與 D1（CAS 後）：正常路徑只接受 D0 多一筆該 generation、expected old OID 到 zero OID 的刪除記錄，並立即將 D1 落盤。若 CAS 成功但 D1 尚未 checkpoint 就當機，啟動 reconciliation 也只能在滿足同一 D0 加單一預期記錄時重建 D1；多任何其他記錄即 fail-closed。

完整清理的本地 branch reflog 刪除能力要求 Git 支援 `git reflog drop <full-ref>`；啟動時做 capability probe，不支援時禁用完整清理並顯示更新 Git 的指引，不降級手動刪 `.git/logs` 或逐項刪 entry。

## 原因

分階段 lease 可區分 Polydesk 自己造成的預期 reflog 變化與外部 Git 競態；明確能力門檻則比不可能真正 drop reflog 的舊版假 fallback 可驗證。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 `update-ref` 的正常刪除記錄會使 D0 變化，且舊版 `reflog delete` 無法讓 reflog 本體不存在。
