import { describe, expect, it } from 'vitest';
import { findTerminalFileLinks } from './terminalFileLinks';

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
    expect(findTerminalFileLinks('https://example.com hello package')).toEqual([]);
    expect(findTerminalFileLinks('src/evil\u0000.txt')).toEqual([]);
  });
});
