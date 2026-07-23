import { describe, expect, it } from 'vitest';
import { findTerminalFileCellLinks, findTerminalFileLinks } from './terminalFileLinks';

describe('findTerminalFileLinks', () => {
  it('辨識 Windows、家目錄與工作區相對路徑，並解析行欄', () => {
    const text = '錯誤 C:\\repo\\src\\app.ts:42:8；圖片 ~\\AppData\\Local\\Temp\\shot.png；見 src/main.ts:7';
    expect(findTerminalFileLinks(text).map(({ path, line, col }) => ({ path, line, col }))).toEqual([
      { path: 'C:\\repo\\src\\app.ts', line: 42, col: 8 },
      { path: '~\\AppData\\Local\\Temp\\shot.png', line: undefined, col: undefined },
      { path: 'src/main.ts', line: 7, col: undefined },
    ]);
  });

  it('引號內路徑可含空白，連結範圍不包含引號與句尾標點', () => {
    const text = '開啟 "C:\\My Repo\\read me.md:3"。';
    const [match] = findTerminalFileLinks(text);
    expect(match).toMatchObject({ text: 'C:\\My Repo\\read me.md:3', path: 'C:\\My Repo\\read me.md', line: 3 });
    expect(text.slice(match.start, match.end)).toBe(match.text);
  });

  it('忽略網址、一般文字與控制字元', () => {
    expect(findTerminalFileLinks('https://example.com hello package N/A workflow/subagent API/資料表')).toEqual([]);
    expect(findTerminalFileLinks('src/evil\u0000.txt')).toEqual([]);
  });

  it('仍辨識有副檔名的未加 ./ 相對路徑', () => {
    expect(findTerminalFileLinks('請看 src/rules/asteria-vault.md')).toEqual([
      expect.objectContaining({ path: 'src/rules/asteria-vault.md' }),
    ]);
  });
});

describe('findTerminalFileCellLinks', () => {
  it('把中文與 emoji 的字串索引換成正確 xterm 格位', () => {
    const values = [
      { chars: '請', width: 2 },
      { chars: '', width: 0 },
      { chars: '看', width: 2 },
      { chars: '', width: 0 },
      { chars: '🙂', width: 2 },
      { chars: '', width: 0 },
      { chars: ' ', width: 1 },
      ...Array.from('src/app.ts').map((chars) => ({ chars, width: 1 })),
    ];
    const [match] = findTerminalFileCellLinks({
      length: values.length,
      getCell: (index) => {
        const value = values[index];
        return value ? { getChars: () => value.chars, getWidth: () => value.width } : undefined;
      },
    });
    expect(match).toMatchObject({ path: 'src/app.ts', cellStart: 7, cellEnd: 17 });
  });
});
