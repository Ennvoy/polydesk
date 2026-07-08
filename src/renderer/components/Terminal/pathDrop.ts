// 側欄/OS 檔案拖進終端機 → 貼上絕對路徑（VS Code 慣例）。
// 純函式層：引號策略依 shell 決定；「需要才包」用白名單判定（名單外任一字元一律包＝fail-safe 方向，
// 中文檔名在白名單內、照 VS Code 慣例裸貼）。

import type { ShellKind } from '../../../shared/types';

/** Explorer 拖曳檔案用的自訂 MIME：終端機 drop 只認它與 OS 'Files'，不吃裸 text/plain（那是終端機分頁拖曳排序的 payload）。 */
export const DRAG_PATH_MIME = 'application/x-polydesk-path';

// 免引號白名單：字母（含中日韓）/數字/_-.:\/。名單外（空白、'"`$&(){};,^%! 等）→ 包引號。
const SAFE_BARE = /^[\p{L}\p{N}_\-.:\\/]+$/u;
// 控制字元（C0 + DEL）：路徑含它即整條拒貼——xterm 的 paste 會把 \n 轉 \r（＝Enter，未按確認就執行），
// 內嵌 \x1b[201~ 更可提前關閉 bracketed paste 逃逸引號（WSL/SMB/ext4 後端的檔名可含這些字元）。
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\x00-\x1f\x7f]/;

/** C:\a\b → /mnt/c/a/b（WSL 內可用的形式）；非磁碟機開頭（UNC 等）無法可靠對應 → 原樣返回。 */
function toWslPath(path: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : path;
}

/** 單一路徑 → 該 shell 可安全貼上的 token（必要時包引號；引號風格依 shell）。 */
export function quotePathForShell(path: string, shell: ShellKind): string {
  if (path === '') return path;
  switch (shell) {
    case 'cmd':
      // Windows 檔名不可含 "，包起來即安全。已知限制（VS Code 同）：cmd 的 %VAR% 展開發生在
      // 解析早期、雙引號內照樣展開——檔名恰含成對 % 夾住已定義變數名時會被代換，互動式 cmd 無完美引號法。
      return SAFE_BARE.test(path) ? path : `"${path}"`;
    case 'gitbash':
    case 'wsl': {
      // POSIX shell：裸的 \ 是跳脫字元（Enter 執行時被 parser 吃掉，C:\Users\x 變 C:Usersx），
      // 故含反斜線即包單引號（單引號內 literal；MSYS 可解析 C:\ 形式路徑）。wsl 另須轉 /mnt/<碟符>。
      const p = shell === 'wsl' ? toWslPath(path) : path;
      if (SAFE_BARE.test(p) && !p.includes('\\')) return p;
      return `'${p.replace(/'/g, `'\\''`)}'`; // 單引號 literal，內部 ' → '\''
    }
    default:
      return SAFE_BARE.test(path) ? path : `'${path.replace(/'/g, "''")}'`; // powershell/pwsh：單引號 literal，內部 ' 翻倍
  }
}

/** 多路徑 → 一次貼上的字串（空格分隔，VS Code 慣例）。含控制字元的路徑整條剔除（注入防禦）。 */
export function formatPathsForShell(paths: string[], shell: ShellKind): string {
  return paths
    .filter((p) => p !== '' && !HAS_CONTROL.test(p))
    .map((p) => quotePathForShell(p, shell))
    .join(' ');
}
