// worktree 命名純邏輯（單一真相；main 與 renderer 共用）。
// 刻意「零 node 依賴」（不 import node:fs/node:path）——renderer bundle 也 import 這支，
// 故用純字串處理跨平台路徑分隔（node:path 的驗證/realpath 留在 main 端 worktreePath.ts）。

/** Windows 保留裝置名（完整名或「名.副檔名」皆不可當資料夾名）。 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Windows 非法檔名字元＋控制字元（'/' 已先轉 '-'；'\' 一併剔除；連字號合法保留）。 */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"|?*\\\u0000-\u001f]/g;
const MAX_SLUG = 60;

/** 分支名 → 資料夾 slug：`/`→`-`、剔非法字元、去結尾點/空白（trim 先於保留名判定＝roundtrip 不變性）、
 *  ≤60、Windows 保留名前綴 wt-。 */
export function branchSlug(branch: string): string {
  let s = (branch ?? '').replace(/\//g, '-').replace(ILLEGAL, '');
  s = s.replace(/[. ]+$/g, '');
  if (s.length > MAX_SLUG) s = s.slice(0, MAX_SLUG).replace(/[. ]+$/g, '');
  if (RESERVED.test(s)) s = `wt-${s}`;
  if (s.length === 0) s = 'wt';
  return s;
}

/** sibling 慣例：`<repo 上層>/<repo 名>-worktrees`（純字串；保留原路徑分隔符）。 */
export function defaultWorktreeBase(mainPath: string): string {
  const sep = mainPath.includes('\\') ? '\\' : '/';
  const trimmed = mainPath.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const parent = idx > 0 ? trimmed.slice(0, idx) : trimmed.slice(0, idx + 1) || trimmed;
  const name = trimmed.slice(idx + 1);
  return `${parent}${sep}${name}-worktrees`;
}
