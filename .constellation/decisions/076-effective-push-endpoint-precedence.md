# 076 effective push endpoint 的 Git precedence

## 背景

Remote 可同時有 fetch URL、`pushurl` 與 URL rewrite；若把設定值直接聯集，可能對使用者刻意只供讀取的來源送出刪除。

## 決定

遠端刪除 endpoint 一律以 `git remote get-url --push --all <remote>` 在目標 repository 的當下 config context 解析 effective push URLs。存在一或多個 `remote.<name>.pushurl` 時，它們完整取代 `remote.<name>.url`；沒有 pushurl 時才使用 Git 判定的有效 push URL 集合。`url.*.pushInsteadOf`、`insteadOf` 與 include/config scope precedence 由 Git 命令展開後才 fingerprint、遮罩、顯示與查詢，不自行拼接 raw config。

Journal 保存 remote name、canonical effective endpoint fingerprints、解析輸入的 config origin/value digest 與確認 generation；每個 endpoint 動手前重新執行同一解析並比較。集合或 rewrite 變動即回到 discovery。原始 URL 仍不得寫入 userData；無法把 fingerprint 重新解析回唯一 effective endpoint 就停下。

## 原因

交由 Git 解析 push precedence 可避免對 fetch-only URL 錯刪，也能正確處理多 pushurl 與 URL rewrite。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 053 未明定 pushurl 取代 url 與 rewrite precedence，字面聯集會誤選只讀來源。
