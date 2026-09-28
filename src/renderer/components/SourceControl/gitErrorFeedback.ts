export interface GitErrorFeedback {
  summary: string;
  nextStep: string;
}

/** 分類僅供顯示；不依診斷原文自動執行任何 Git 操作。 */
export function gitErrorFeedback(detail: string): GitErrorFeedback {
  if (/變更已暫存到 stash，但切換/.test(detail)) {
    return { summary: '變更已存入 stash，分支切換未完成。', nextStep: '目前仍在原分支。先在終端機用 git stash list 核對保存的內容，再到「變更」使用 Stash Pop 取回。' };
  }
  if (/index\.lock|another git process|unable to create.*\.lock/i.test(detail)) {
    return { summary: 'Git 正在被其他操作使用。', nextStep: '先核對終端機或其他程式是否仍在執行 Git，等待操作結束後再重試；確認鎖定檔的持有者前，請保留鎖定檔。' };
  }
  if (/bad object|corrupt|object.*missing|unable to read.*object/i.test(detail)) {
    return { summary: 'Git 資料無法讀取。', nextStep: '先保留並備份 repository，展開技術細節確認失敗的 ref 或 object，再於終端機檢查資料完整性；請保留原有 refs 與檔案。' };
  }
  if (/repository.*not found|remote-not-found|GitHub 上找不到 remote|repository does not exist/i.test(detail)) {
    return { summary: '遠端倉庫不存在或無權限。', nextStep: '確認 remote 指向的倉庫網址、倉庫是否已改名，以及目前帳號的存取權限，再重試。' };
  }
  if (/would be overwritten|please commit your changes or stash|please move or remove/i.test(detail)) {
    return { summary: '本機檔案會被覆蓋，Git 已停止操作。', nextStep: '先檢查「變更」中的檔案，再提交或使用 Stash 保存（包含新檔）；確認保存完成後再重試。' };
  }
  if (/conflict|unmerged|resolve your current index/i.test(detail)) {
    return { summary: '檔案有合併衝突，需要先處理。', nextStep: '在「變更」開啟衝突檔，處理衝突標記後重新暫存。Stash Pop 發生衝突時，原 stash 會保留；請先核對內容再繼續。' };
  }
  if (/divergent branches|need to specify how to reconcile/i.test(detail)) {
    return { summary: '本地與遠端分支各有新提交。', nextStep: '先檢查「歷史」兩邊的提交，再於終端機選擇 merge 或 rebase 的整合方式。' };
  }
  if (/no tracking information|no upstream|沒有追蹤|尚未設定遠端|no configured push destination/i.test(detail)) {
    return { summary: '分支尚未設定對應的遠端。', nextStep: '確認 remote 與目標分支；新分支可先推送以設定 upstream，無遠端的專案可使用「發佈到 GitHub」。' };
  }
  if (/authentication|permission denied|認證失敗|could not read username/i.test(detail)) {
    return { summary: 'Git 遠端認證失敗。', nextStep: '在終端機確認 Git Credential Manager 或 SSH 金鑰與 repository 存取權限，再重試。' };
  }
  if (/Git (?:本機操作|狀態讀取)逾時/.test(detail)) {
    return { summary: 'Git 本機讀取或操作未完成。', nextStep: '先檢查 repository 目前的變更與分支狀態，再重試；展開技術細節確認是哪個本機操作逾時。' };
  }
  if (/timed? ?out|逾時|could not resolve host|unable to access|網路連線失敗/i.test(detail)) {
    return { summary: 'Git 遠端連線未完成。', nextStep: '確認網路、VPN 與代理設定，再重新整理狀態；逾時後請核對遠端結果再重試。' };
  }
  if (/non-fast-forward|fetch first|rejected/i.test(detail)) {
    return { summary: '遠端拒絕這次操作。', nextStep: '先重新整理並檢查遠端提交與分支保護規則，再處理差異；請勿直接強制推送。' };
  }
  if (/no stash entries/i.test(detail)) {
    return { summary: '目前沒有可還原的 stash。', nextStep: '可在終端機執行 git stash list 核對保存的變更。' };
  }
  return { summary: 'Git 操作未完成。', nextStep: '檢查目前的變更與分支狀態，展開技術細節查看原因，再決定下一步。' };
}

export function gitErrorDetail(detail: string): string {
  return detail.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '�');
}
