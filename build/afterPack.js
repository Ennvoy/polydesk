// electron-builder afterPack hook（X-2）：打包後驗證關鍵原生模組/執行檔確實落在
// app.asar.unpacked（REQ-NFR-003）。缺檔即 fail-fast（避免交付出「啟動即找不到 pty.node」的壞包）。
// 用遞迴搜尋（平台套件可能被 de-hoist 到巢狀 node_modules，路徑不固定）。
//
// 打包設定的單一來源是 package.json 的 "build" 鍵（v0.33.0 拍板）。歷史上另有一份
// electron-builder.yml（nsis/publish 佔位），但 app-builder-lib 只要 package.json 有 "build" 鍵就
// 整份忽略 yml——它從未生效（本 hook 也因只掛在 yml 而從未執行過），v0.33.0 已刪除以免誤導。
// 由 yml 保留下來的設定理由（JSON 放不了註解，記在這裡）：
//  - electronVersion 鎖 33.4.11：中文路徑下自動偵測曾失敗，明示避免；升 electron 時同步改。
//  - npmRebuild false：node-pty 用 N-API prebuild（ABI 跨 Node/Electron 穩定，decision
//    NODE-PTY-NAPI），本機無 Visual Studio，直接打包 prebuild 二進位。
//  - asarUnpack：原生模組要 dlopen、外部 exe 要 spawn，必須是真檔案不能在 asar 內；
//    node-pty 整包 unpack 涵蓋 prebuilds/win32-x64/conpty/{conpty.dll,OpenConsole.exe}
//    （USE_CONPTY_DLL 用；缺檔時 node-pty 是大聲丟錯不是默默 fallback，故列入下方必檢）。
//  - 自動更新 publish 設定曾是佔位（generic provider 假 URL），未生效即隨 yml 移除。

const { existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

function findFile(root, name, depth = 8) {
  if (depth < 0 || !existsSync(root)) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) {
      const found = findFile(p, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** @param {{ appOutDir: string }} context */
exports.default = async function afterPack(context) {
  const unpacked = join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules');
  if (!existsSync(unpacked) || !statSync(unpacked).isDirectory()) {
    throw new Error('[afterPack] 找不到 app.asar.unpacked/node_modules——asarUnpack 未生效');
  }
  // conpty.dll / OpenConsole.exe：USE_CONPTY_DLL（Claude 分頁捲不動／吃字的修法）賴以維生，
  // 缺檔時 node-pty 開終端機即 spawn-failed（錯誤含 "Cannot find conpty.dll"），必須擋在打包期。
  const required = ['pty.node', 'conpty.node', 'winpty.dll', 'rg.exe', 'conpty.dll', 'OpenConsole.exe'];
  const missing = required.filter((f) => !findFile(unpacked, f));
  if (missing.length) {
    throw new Error(
      `[afterPack] 關鍵二進位未 unpack（會導致啟動崩潰）：${missing.join(', ')}\n` +
        `請檢查 package.json "build" 的 asarUnpack 規則。`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('[afterPack] ✓ node-pty (pty/conpty/conpty.dll/OpenConsole/winpty) 與 ripgrep (rg.exe) 二進位已正確 unpack');
};
