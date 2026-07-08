// pathDrop 純函式測試：各 shell 的引號策略（需要才包；中文裸貼；引號字元正確 escape；
// POSIX shell 反斜線不裸貼；wsl 轉 /mnt/<碟符>；控制字元路徑整條拒貼）。
import { describe, expect, it } from 'vitest';
import { formatPathsForShell, quotePathForShell } from './pathDrop';

describe('quotePathForShell', () => {
  it('無特殊字元（含中文/冒號/反斜線）：powershell/pwsh/cmd 裸貼', () => {
    const p = 'C:\\Users\\ennvoy\\Documents\\我的終端機\\src\\main.ts';
    for (const shell of ['powershell', 'pwsh', 'cmd'] as const) {
      expect(quotePathForShell(p, shell)).toBe(p);
    }
  });

  it('gitbash：含反斜線即包單引號（裸的 \\ 會被 bash parser 當跳脫字元吃掉）', () => {
    expect(quotePathForShell('C:\\Users\\me\\plain.txt', 'gitbash')).toBe("'C:\\Users\\me\\plain.txt'");
    // 正斜線形式無反斜線、無特殊字元 → 可裸貼
    expect(quotePathForShell('C:/Users/me/plain.txt', 'gitbash')).toBe('C:/Users/me/plain.txt');
  });

  it('wsl：磁碟機路徑轉 /mnt/<小寫碟符>/…（WSL 內可用），轉完無特殊字元則裸貼', () => {
    expect(quotePathForShell('C:\\Users\\me\\a.txt', 'wsl')).toBe('/mnt/c/Users/me/a.txt');
    expect(quotePathForShell('D:\\data\\旅遊 照片\\a.jpg', 'wsl')).toBe("'/mnt/d/data/旅遊 照片/a.jpg'");
    // 非磁碟機開頭（UNC）無法可靠對應 → 原樣（含反斜線 → 包單引號）
    expect(quotePathForShell('\\\\server\\share\\a.txt', 'wsl')).toBe("'\\\\server\\share\\a.txt'");
  });

  it('含空白：powershell/pwsh 包單引號、cmd 包雙引號、gitbash 包單引號', () => {
    const p = 'C:\\My Files\\note.txt';
    expect(quotePathForShell(p, 'powershell')).toBe(`'${p}'`);
    expect(quotePathForShell(p, 'pwsh')).toBe(`'${p}'`);
    expect(quotePathForShell(p, 'cmd')).toBe(`"${p}"`);
    expect(quotePathForShell(p, 'gitbash')).toBe(`'${p}'`);
  });

  it("含單引號：powershell 內部 ' 翻倍、gitbash 用 '\\'' 斷開", () => {
    const p = "C:\\it's here\\a.txt";
    expect(quotePathForShell(p, 'powershell')).toBe("'C:\\it''s here\\a.txt'");
    expect(quotePathForShell(p, 'gitbash')).toBe("'C:\\it'\\''s here\\a.txt'");
  });

  it('PowerShell 特殊字元（$ ` & ( ) ; , % 等）也觸發包引號（fail-safe）', () => {
    for (const p of ['C:\\a$b.txt', 'C:\\a&b.txt', 'C:\\a(1).txt', 'C:\\a;b.txt', 'C:\\a`b.txt', 'C:\\%temp%x.txt']) {
      expect(quotePathForShell(p, 'powershell')).toBe(`'${p}'`);
    }
  });

  it('空字串原樣返回', () => {
    expect(quotePathForShell('', 'powershell')).toBe('');
  });
});

describe('formatPathsForShell', () => {
  it('多路徑以空格分隔，各自獨立判斷引號', () => {
    expect(formatPathsForShell(['C:\\plain.txt', 'C:\\has space.txt'], 'powershell')).toBe(
      "C:\\plain.txt 'C:\\has space.txt'",
    );
  });

  it('含控制字元（\\n、ESC、DEL）的路徑整條剔除（防 CR=Enter 自動執行與 bracketed paste 逃逸）', () => {
    expect(formatPathsForShell(['C:\\a\ncalc.txt', 'C:\\ok.txt'], 'powershell')).toBe('C:\\ok.txt');
    expect(formatPathsForShell(['C:\\a\x1b[201~b.txt'], 'gitbash')).toBe('');
    expect(formatPathsForShell(['C:\\a\x7fb.txt'], 'cmd')).toBe('');
  });
});
