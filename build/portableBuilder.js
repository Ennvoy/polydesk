// electron-builder 25.1.8 對 portable 固定讀內附 portable.nsi，沒有 script/include 設定。
// 建置時複製模板並替換解壓目錄與啟動交接區塊；不修改 node_modules，也不新增原生 launcher。
// 此版 builder 即使 unpackDirName=false 仍寫入打包時固定的 KSUID，須強制改用每次啟動獨立的 $PLUGINSDIR/app。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUILDER_VERSION = '25.1.8';
const ORIGINAL_GUI_INIT = 'Function .onGUIInit\n  InitPluginsDir';
const ORIGINAL_BG_REDRAW = '    BgImage::Redraw\n  !endif\nFunctionEnd';
const ORIGINAL_UNPACK_DIR = [
  '  StrCpy $INSTDIR "$PLUGINSDIR\\app"',
  '  !ifdef UNPACK_DIR_NAME',
  '    StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"',
  '  !endif',
].join('\n');
const ORIGINAL_HANDOFF = [
  '  !ifdef SPLASH_IMAGE',
  '    BgImage::Destroy',
  '  !endif',
  '',
  '\tExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0',
].join('\n');

const CONTINUOUS_HANDOFF = [
  '  ; Keep the native BMP visible until Electron reports a visible main or failure window.',
  '  ${StdUtils.ExecShellWaitEx} $R1 $R2 "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "open" "$R0"',
  '  StrCmp $R1 "ok" startup_wait',
  '  StrCmp $R1 "no_wait" startup_no_wait startup_launch_failed',
  '',
  '  startup_wait:',
  '    ; StdUtils returns hProc:XXXXXXXX, not a numeric HANDLE. Keep $R2 for WaitForProcEx.',
  '    StrCpy $R5 $R2 6',
  '    StrCmp $R5 "hProc:" 0 startup_wait_failed',
  '    StrCpy $R5 $R2 "" 6',
  '    IfFileExists "$INSTDIR\\.polydesk-startup-ready" startup_visible',
  '    System::Call \'kernel32::WaitForSingleObject(p 0x$R5, i 0) i .R3\'',
  '    IntCmp $R3 0 startup_exited',
  '    IntCmp $R3 258 startup_still_running',
  '    Goto startup_wait_failed',
  '  startup_still_running:',
  '    Sleep 50',
  '    IntOp $R4 $R4 + 1',
  '    IntCmp $R4 2400 startup_timed_out 0 startup_timed_out',
  '    Goto startup_wait',
  '  startup_timed_out:',
  '    BgImage::Destroy',
  '    MessageBox MB_OK|MB_ICONEXCLAMATION "Polydesk 啟動超過兩分鐘，請確認主視窗或於工作管理員結束程式。"',
  '    Goto startup_join',
  '  startup_wait_failed:',
  '    BgImage::Destroy',
  '    MessageBox MB_OK|MB_ICONSTOP "無法確認 Polydesk 的啟動狀態；請結束程式並重新啟動。"',
  '    StrCpy $R6 1',
  '    StrCpy $0 1',
  '    Goto startup_cleanup',
  '  startup_exited:',
  '    BgImage::Destroy',
  '    Goto startup_join',
  '  startup_visible:',
  '    BgImage::Destroy',
  '  startup_join:',
  '    ${StdUtils.WaitForProcEx} $0 $R2',
  '    StrCmp $0 "error" startup_join_failed startup_cleanup',
  '  startup_join_failed:',
  '    StrCpy $0 1',
  '    Goto startup_cleanup',
  '  startup_launch_failed:',
  '    BgImage::Destroy',
  '    MessageBox MB_OK|MB_ICONSTOP "無法啟動 Polydesk（Windows 錯誤：$R2）。"',
  '    StrCpy $0 1',
  '    Goto startup_cleanup',
  '  startup_no_wait:',
  '    BgImage::Destroy',
  '    StrCpy $0 0',
  '  startup_cleanup:',
].join('\n');

function patchPortableTemplate(template) {
  const normalized = template.replace(/\r\n/g, '\n');
  if (normalized.split(ORIGINAL_UNPACK_DIR).length !== 2) {
    throw new Error('electron-builder portable.nsi 解壓目錄區塊已變更；停止打包');
  }
  if (normalized.split(ORIGINAL_GUI_INIT).length !== 2) {
    throw new Error('electron-builder portable.nsi GUI 初始化區塊已變更；停止打包');
  }
  if (normalized.split(ORIGINAL_BG_REDRAW).length !== 2) {
    throw new Error('electron-builder portable.nsi 背景畫面區塊已變更；停止打包');
  }
  if (normalized.split(ORIGINAL_HANDOFF).length !== 2) {
    throw new Error('electron-builder portable.nsi 啟動區塊已變更；停止打包，請檢查模板');
  }
  const cleanupBlock = '\tRMDir /r $INSTDIR\nSectionEnd';
  if (normalized.split(cleanupBlock).length !== 2) {
    throw new Error('electron-builder portable.nsi 清理區塊已變更；停止打包');
  }
  return normalized.replace(ORIGINAL_GUI_INIT, 'Function .onGUIInit\n  HideWindow\n  InitPluginsDir')
    .replace(ORIGINAL_BG_REDRAW, [
      '    BgImage::Redraw',
      '    ; NSIS shows its setup dialog after .onGUIInit; keep that dialog offscreen.',
      "    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i -32000, i -32000, i 0, i 0, i 0x15) i .R7'",
      '  !endif',
      'FunctionEnd',
    ].join('\n'))
    .replace(ORIGINAL_UNPACK_DIR, '  StrCpy $INSTDIR "$PLUGINSDIR\\app"')
    .replace(ORIGINAL_HANDOFF, CONTINUOUS_HANDOFF)
    .replace('  ${StdUtils.GetAllParameters} $R0 0\n', '  ${StdUtils.GetAllParameters} $R0 0\n  StrCpy $R4 0\n  StrCpy $R6 0\n')
    .replace(cleanupBlock, '  StrCmp $R6 1 startup_preserve\n\tRMDir /r $INSTDIR\n  startup_preserve:\nSectionEnd');
}

function copyTemplateDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTemplateDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`不支援的 NSIS 模板項目：${entry.name}`);
  }
}

async function main() {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--qa')) {
    throw new Error('用法：node build/portableBuilder.js [--qa]');
  }
  const installed = require('app-builder-lib/package.json').version;
  if (installed !== BUILDER_VERSION || require('electron-builder/package.json').version !== BUILDER_VERSION) {
    throw new Error(`portable 模板僅驗證 electron-builder ${BUILDER_VERSION}，目前為 ${installed}`);
  }

  const nsisUtil = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const originalDir = nsisUtil.nsisTemplatesDir;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'polydesk-nsis-'));
  const templateDir = path.join(tempRoot, 'nsis');
  try {
    copyTemplateDirectory(originalDir, templateDir);
    const portablePath = path.join(templateDir, 'portable.nsi');
    fs.writeFileSync(portablePath, patchPortableTemplate(fs.readFileSync(portablePath, 'utf8')), 'utf8');
    nsisUtil.nsisTemplatesDir = templateDir;
    const qaConfig = process.argv[2] === '--qa'
      ? { directories: { output: path.resolve(__dirname, '../../polydesk-qa-dist') } }
      : undefined;
    await require('electron-builder').build({ win: ['portable'], x64: true, config: qaConfig });
  } finally {
    nsisUtil.nsisTemplatesDir = originalDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { patchPortableTemplate };
