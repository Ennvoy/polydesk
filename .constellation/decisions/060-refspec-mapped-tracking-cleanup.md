# 060 remote-tracking refspec 映射清理

## 背景

remote branch 在本機的 tracking ref 由 `remote.<name>.fetch` refspec 決定，可能是自訂 namespace、多組映射或零個映射，不一定是 `refs/remotes/<remote>/<branch>`。

## 決定

決議 053 中的 remote-tracking 清理必須將每組 fetch refspec 實際映射成零、一或多個完整 local ref，不得使用固定路徑假設。對每個 local ref 必須建立能產生它的完整 producer set（所有 remote、source refspec 與負 refspec 影響）；只有所有 producer 都被明確選中且各自 endpoint 證明目標 ref 已缺席，才能刪該 local ref。任一重疊、負 refspec 或來源無法唯一解釋時一律保留。每個 local ref、expected OID、producer set 與完整 canonical refspec digest 都在不可逆步驟前寫入 journal；任一 refspec 變動即重新 discovery 與確認，不使用舊 journal CAS。未映射、endpoint 未選或仍有 ref 時一律保留，並在風險可達性計數當作保留 ref。

## 原因

依 Git refspec 的真實映射才能正確處理自訂 namespace，並避免刪除不屬於目標 remote branch 的共用 local ref。

## 證據

使用者授權「全部依照你的建議做完」。獨立盲點審查指出決議 053 假定了 Git 並不保證的固定 remote-tracking ref 路徑。
