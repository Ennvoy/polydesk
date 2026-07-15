// 發佈到 GitHub 的純函式驗證（DF-12）。與 gitClone.ts 同慣例：
// renderer / main 共用、零 Node API 依賴，可在任何環境單測。

/**
 * GitHub repository 名稱驗證：回傳錯誤訊息，合法回 null。
 * GitHub 限制：ASCII 英數與 `.`、`-`、`_`，上限 100 字元。
 * 另禁止開頭 `.`/`-`（`-` 開頭會被 CLI 當旗標解析＝參數注入面；`.`/`..` 為保留名）、
 * 禁止 `.git` 結尾（GitHub 保留）。
 */
export function publishRepoNameError(name: string): string | null {
  const n = name.trim();
  if (!n) return '請輸入 Repository 名稱。';
  if (n.length > 100) return '名稱過長（GitHub 上限 100 字元）。';
  if (!/^[A-Za-z0-9_.-]+$/.test(n)) return '名稱只能使用英數字與 - _ .（GitHub 限制）。';
  if (/^[.-]/.test(n)) return '名稱不能以 . 或 - 開頭。';
  if (/\.git$/i.test(n)) return '名稱不能以 .git 結尾（GitHub 保留）。';
  return null;
}

/** 工作區資料夾名 → 合法 repo 名預設值（非法字元轉 -、修剪頭尾保留字元；空則 fallback）。 */
export function defaultRepoName(folderName: string): string {
  const s = folderName
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[-]+$/, '');
  return s || 'my-repo';
}
