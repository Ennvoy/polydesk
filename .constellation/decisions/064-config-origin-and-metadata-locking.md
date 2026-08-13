# 064 branch config origin 與 metadata 鎖定

## 背景

Git config 可來自 system、global、include、repository-local 或 worktree scope；以 effective config 直接刪除會誤碰外部檔案，先比 digest 後 remove-section 也存在競態窗口。

## 決定

metadata snapshot 必須使用 `git config --show-origin --show-scope --null --get-regexp` 保存 origin、scope、NUL-safe key/value 與重複數量。Polydesk 只能自動修改 repository-local config 與同 repository 的 `config.worktree`；global、system、command 或外部 include 中的同名 `branch.<name>.*` 只顯示殘留並 fail-closed，不自動編輯。

對可修改的 config 檔使用 Git 的 `<config>.lock` 慣例做 O_EXCL 鎖：鎖後重讀並驗證 journal 的 origin/value/multiplicity digest，只移除預期 section，fsync 新檔後原子取代再釋鎖。每棵 worktree 的 `config.worktree` 必須用該 worktree 自己的 `git rev-parse --git-path config.worktree` 逐一解析、snapshot、journal、鎖定與清理，不得只清發起 cwd。建 lock 前 journal 先落盤 lock generation、target config identity、pre-image/post-image digest；啟動遇 stale lock 時，只有内容等於該 generation 完整 post-image 才可完成 rename，等於已記錄的未完成 lock 才可移除，無法證明所有權的 lock 一律不碰並轉人工處理。無法取得鎖、檔案 identity 變動或 digest 不符即停止。

## 原因

限制 origin 與沿用 Git lockfile protocol，可避免完整清理篡改使用者的全域設定，也能把 metadata expected-state 與實際寫入綁在同一鎖內。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出 branch config snapshot 未定義 scope/origin，且先比對後刪除的非原子做法可被外部修改穿透。
