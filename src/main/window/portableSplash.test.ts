import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import packageJson from '../../../package.json';

const require = createRequire(import.meta.url);
const { patchPortableTemplate } = require('../../../build/portableBuilder.js') as {
  patchPortableTemplate: (source: string) => string;
};

describe('portable 啟動畫面封裝契約', () => {
  it('自解壓期間顯示 420×230、24-bit RGB BMP', () => {
    expect(packageJson.build.portable).toHaveProperty('splashImage', 'build/portable-splash.bmp');
    expect(packageJson.build.portable).toHaveProperty('unpackDirName', false);
    const bmp = readFileSync(join(__dirname, '../../../build/portable-splash.bmp'));
    expect(bmp.toString('ascii', 0, 2)).toBe('BM');
    expect(bmp.readInt32LE(18)).toBe(420);
    expect(bmp.readInt32LE(22)).toBe(230);
    expect(bmp.readUInt16LE(28)).toBe(24);
    expect(bmp.readUInt32LE(30)).toBe(0);
  });

  it('打包時只改既有模板交接，主畫面出現後才關閉 BMP', () => {
    const original = readFileSync(join(__dirname, '../../../node_modules/app-builder-lib/templates/nsis/portable.nsi'), 'utf8');
    const patched = patchPortableTemplate(original);
    expect(patched).toContain('Function .onGUIInit\n  HideWindow\n  InitPluginsDir');
    expect(patched).toContain('BgImage::Redraw\n    ; NSIS shows its setup dialog after .onGUIInit; keep that dialog offscreen.');
    expect(patched).toContain("SetWindowPos(p $HWNDPARENT, p 0, i -32000, i -32000, i 0, i 0, i 0x15)");
    expect(patched).toContain('StrCpy $INSTDIR "$PLUGINSDIR\\app"');
    expect(patched).not.toContain('!ifdef UNPACK_DIR_NAME');
    expect(patched).not.toContain('StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"');
    expect(patched).toContain('IfFileExists "$INSTDIR\\.polydesk-startup-ready" startup_visible');
    expect(patched).toContain('StrCmp $R5 "hProc:" 0 startup_wait_failed');
    expect(patched).toContain('WaitForSingleObject(p 0x$R5, i 0)');
    expect(patched).toContain('StdUtils.WaitForProcEx} $0 $R2');
    expect(patched).toContain('StrCmp $R1 "no_wait" startup_no_wait startup_launch_failed');
    expect(patched.indexOf('BgImage::Destroy')).toBeGreaterThan(patched.indexOf('ExecShellWaitEx'));
    expect(patched).toContain('StdUtils.WaitForProcEx');
    expect(patched).toContain('RMDir /r $INSTDIR');
    expect(() => patchPortableTemplate(original.replace('BgImage::Destroy', 'BgImage::Redraw'))).toThrow();
    expect(() => patchPortableTemplate(original.replace('    BgImage::Redraw\n  !endif\nFunctionEnd', '    BgImage::Redraw\nFunctionEnd'))).toThrow();
    expect(() => patchPortableTemplate(original.replace('StrCpy $INSTDIR "$PLUGINSDIR\\app"', 'StrCpy $INSTDIR "$TEMP\\app"'))).toThrow();
  });
});
