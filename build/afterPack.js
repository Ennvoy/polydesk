// electron-builder afterPack hook（X-2）：打包後驗證關鍵原生模組/執行檔確實落在
// app.asar.unpacked（REQ-NFR-003）。缺檔即 fail-fast（避免交付出「啟動即找不到 pty.node」的壞包）。
// 用遞迴搜尋（平台套件可能被 de-hoist 到巢狀 node_modules，路徑不固定）。

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
  const required = ['pty.node', 'conpty.node', 'winpty.dll', 'rg.exe'];
  const missing = required.filter((f) => !findFile(unpacked, f));
  if (missing.length) {
    throw new Error(
      `[afterPack] 關鍵二進位未 unpack（會導致啟動崩潰）：${missing.join(', ')}\n` +
        `請檢查 electron-builder.yml 的 asarUnpack 規則。`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('[afterPack] ✓ node-pty (pty/conpty/winpty) 與 ripgrep (rg.exe) 二進位已正確 unpack');
};
