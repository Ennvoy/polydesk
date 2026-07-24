import { describe, expect, it } from 'vitest';
import { findTerminalWebCellLinks, findTerminalWebLinks } from './terminalWebLinks';

describe('findTerminalWebLinks', () => {
  it('辨識 HTTP(S) 與 localhost，連結範圍不包含句尾標點', () => {
    const text = '入口 http://localhost:3000，文件：https://example.com/docs?q=1。';
    const matches = findTerminalWebLinks(text);
    expect(matches.map(({ text: label, url }) => ({ label, url }))).toEqual([
      { label: 'http://localhost:3000', url: 'http://localhost:3000/' },
      { label: 'https://example.com/docs?q=1', url: 'https://example.com/docs?q=1' },
    ]);
    for (const match of matches) expect(text.slice(match.start, match.end)).toBe(match.text);
  });

  it('保留 URL 內成對括號，移除句尾多餘右括號', () => {
    expect(findTerminalWebLinks('見 https://example.com/wiki/Test_(page)。')[0]?.text).toBe(
      'https://example.com/wiki/Test_(page)',
    );
  });

  it('拒絕危險協定與內嵌帳密', () => {
    expect(findTerminalWebLinks('javascript:alert(1) file:///C:/a.txt data:text/html,x')).toEqual([]);
    expect(findTerminalWebLinks('https://user:token@example.com/private')).toEqual([]);
  });
});

describe('findTerminalWebCellLinks', () => {
  it('把中文與 emoji 前綴換算成正確 xterm 格位', () => {
    const values = [
      { chars: '入', width: 2 },
      { chars: '', width: 0 },
      { chars: '口', width: 2 },
      { chars: '', width: 0 },
      { chars: '🙂', width: 2 },
      { chars: '', width: 0 },
      { chars: ' ', width: 1 },
      ...Array.from('http://localhost:3000').map((chars) => ({ chars, width: 1 })),
    ];
    const [match] = findTerminalWebCellLinks({
      length: values.length,
      getCell: (index) => {
        const value = values[index];
        return value ? { getChars: () => value.chars, getWidth: () => value.width } : undefined;
      },
    });
    expect(match).toMatchObject({ text: 'http://localhost:3000', cellStart: 7, cellEnd: 28 });
  });
});
