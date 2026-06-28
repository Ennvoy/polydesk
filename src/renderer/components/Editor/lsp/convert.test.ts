// F-5 renderer 純轉換單元測試（node 環境，無 monaco）：LSP ↔ monaco 座標/型別轉換正確。
// 邊界：0-based↔1-based、severity/kind 對映、hover 多形 contents、definition 三形、uri 反查。

import { describe, it, expect } from 'vitest';
import {
  extractCompletionItems,
  fsPathToWorkspace,
  isLspLang,
  lspCompletionKindName,
  lspDiagnosticsToMarkers,
  lspHoverToMarkdown,
  lspLocationsToTargets,
  lspRangeToMonaco,
  lspSeverityName,
  parseModelUriPath,
} from './convert';

describe('isLspLang', () => {
  it('支援的 langId 為真，其餘為假', () => {
    expect(isLspLang('rust')).toBe(true);
    expect(isLspLang('python')).toBe(true);
    expect(isLspLang('typescript')).toBe(false); // TS 由 monaco 內建語言服務，不走橋接
    expect(isLspLang('plaintext')).toBe(false);
  });
});

describe('lspRangeToMonaco（0-based → 1-based）', () => {
  it('一般轉換 +1', () => {
    expect(lspRangeToMonaco({ start: { line: 0, character: 0 }, end: { line: 2, character: 5 } })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 6,
    });
  });
  it('缺 end → 退化為 start', () => {
    const r = lspRangeToMonaco({ start: { line: 4, character: 2 } });
    expect(r).toEqual({ startLineNumber: 5, startColumn: 3, endLineNumber: 5, endColumn: 3 });
  });
  it('缺值/負值安全退化', () => {
    expect(lspRangeToMonaco(undefined)).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
    expect(lspRangeToMonaco({ start: { line: -3 } })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    });
  });
});

describe('lspSeverityName', () => {
  it.each([
    [1, 'error'],
    [2, 'warning'],
    [3, 'info'],
    [4, 'hint'],
  ])('LSP severity %i → %s', (sev, name) => {
    expect(lspSeverityName(sev)).toBe(name);
  });
  it('未指定 → error（對齊 VSCode）', () => {
    expect(lspSeverityName(undefined)).toBe('error');
  });
});

describe('lspDiagnosticsToMarkers', () => {
  it('陣列逐筆轉換含 range/severity/message', () => {
    const markers = lspDiagnosticsToMarkers([
      { message: 'unused', severity: 2, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, source: 'rustc', code: 'E0001' },
    ]);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      message: 'unused',
      severity: 'warning',
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 5,
      source: 'rustc',
      code: 'E0001',
    });
  });
  it('非陣列 → 空（清空 marker）', () => {
    expect(lspDiagnosticsToMarkers(null)).toEqual([]);
    expect(lspDiagnosticsToMarkers(undefined)).toEqual([]);
  });
});

describe('lspCompletionKindName + extractCompletionItems', () => {
  it('kind 數字 → monaco kind 鍵名', () => {
    expect(lspCompletionKindName(3)).toBe('Function');
    expect(lspCompletionKindName(6)).toBe('Variable');
    expect(lspCompletionKindName(999)).toBe('Text');
    expect(lspCompletionKindName(undefined)).toBe('Text');
  });
  it('CompletionItem[] 與 {items} 兩形皆解析', () => {
    const a = extractCompletionItems([{ label: 'foo', kind: 3 }]);
    expect(a[0]).toMatchObject({ label: 'foo', kind: 'Function', insertText: 'foo' });
    const b = extractCompletionItems({ items: [{ label: 'bar', kind: 6, insertText: 'bar()' }] });
    expect(b[0]).toMatchObject({ label: 'bar', kind: 'Variable', insertText: 'bar()' });
  });
  it('snippet（insertTextFormat=2）標記 isSnippet；textEdit 取 newText + range', () => {
    const items = extractCompletionItems([
      {
        label: 'log',
        kind: 15,
        insertTextFormat: 2,
        textEdit: { newText: 'console.log($1)', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
      },
    ]);
    expect(items[0].isSnippet).toBe(true);
    expect(items[0].insertText).toBe('console.log($1)');
    expect(items[0].range).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 });
  });
  it('物件型 label（{label}）與 markup documentation 解析', () => {
    const items = extractCompletionItems([{ label: { label: 'x' }, documentation: { kind: 'markdown', value: 'doc' } }]);
    expect(items[0].label).toBe('x');
    expect(items[0].documentation).toBe('doc');
  });
});

describe('lspHoverToMarkdown', () => {
  it('string contents', () => {
    expect(lspHoverToMarkdown({ contents: 'hello' })?.value).toBe('hello');
  });
  it('MarkupContent contents', () => {
    expect(lspHoverToMarkdown({ contents: { kind: 'markdown', value: '**bold**' } })?.value).toBe('**bold**');
  });
  it('MarkedString[] contents 合併', () => {
    const r = lspHoverToMarkdown({ contents: [{ language: 'rust', value: 'fn f()' }, 'desc'] });
    expect(r?.value).toContain('fn f()');
    expect(r?.value).toContain('desc');
  });
  it('空/無內容 → null', () => {
    expect(lspHoverToMarkdown(null)).toBeNull();
    expect(lspHoverToMarkdown({ contents: '' })).toBeNull();
  });
});

describe('lspLocationsToTargets（Location | Location[] | LocationLink[]）', () => {
  it('單一 Location', () => {
    const t = lspLocationsToTargets({ uri: 'file:///a.rs', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } });
    expect(t).toHaveLength(1);
    expect(t[0].uri).toBe('file:///a.rs');
    expect(t[0].range.startLineNumber).toBe(1);
  });
  it('Location[]', () => {
    const t = lspLocationsToTargets([
      { uri: 'file:///a.rs', range: { start: { line: 1, character: 0 } } },
      { uri: 'file:///b.rs', range: { start: { line: 2, character: 0 } } },
    ]);
    expect(t.map((x) => x.uri)).toEqual(['file:///a.rs', 'file:///b.rs']);
  });
  it('LocationLink[]（targetUri + targetSelectionRange）', () => {
    const t = lspLocationsToTargets([
      { targetUri: 'file:///c.rs', targetSelectionRange: { start: { line: 9, character: 2 } }, targetRange: { start: { line: 8 } } },
    ]);
    expect(t[0].uri).toBe('file:///c.rs');
    expect(t[0].range.startLineNumber).toBe(10); // 取 selectionRange
  });
  it('null → 空', () => {
    expect(lspLocationsToTargets(null)).toEqual([]);
  });
});

describe('parseModelUriPath（file:///wsId/rel 反解）', () => {
  it('一般路徑', () => {
    expect(parseModelUriPath('/ws_abc/src/main.rs')).toEqual({ wsId: 'ws_abc', rel: 'src/main.rs' });
  });
  it('工作區根（無 rel）', () => {
    expect(parseModelUriPath('/ws_abc')).toEqual({ wsId: 'ws_abc', rel: '' });
  });
  it('空 → null', () => {
    expect(parseModelUriPath('')).toBeNull();
    expect(parseModelUriPath('/')).toBeNull();
  });
});

describe('fsPathToWorkspace（real uri → wsId+rel 反查）', () => {
  const wss = [
    { id: 'ws1', path: 'C:\\Users\\me\\projA' },
    { id: 'ws2', path: 'C:\\Users\\me\\projB' },
  ];
  it('命中工作區並回相對 POSIX', () => {
    expect(fsPathToWorkspace('C:\\Users\\me\\projA\\src\\main.rs', wss)).toEqual({ wsId: 'ws1', rel: 'src/main.rs' });
  });
  it('Windows 大小寫不敏感', () => {
    expect(fsPathToWorkspace('c:\\users\\me\\projb\\x.go', wss)).toEqual({ wsId: 'ws2', rel: 'x.go' });
  });
  it('工作區外 → null（不誤映）', () => {
    expect(fsPathToWorkspace('C:\\Users\\me\\other\\x.rs', wss)).toBeNull();
    // 前綴相似但非子目錄（projA-extra）不可誤命中 projA
    expect(fsPathToWorkspace('C:\\Users\\me\\projA-extra\\x.rs', wss)).toBeNull();
  });
});
