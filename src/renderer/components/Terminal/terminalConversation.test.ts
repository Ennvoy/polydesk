import { describe, expect, it } from 'vitest';
import {
  buildLogicalTerminalLines,
  matchCodexConversationNodes,
  selectCodexConversationSession,
} from './terminalConversation';

describe('buildLogicalTerminalLines', () => {
  it('串回 wrapped continuation 並保留起始行號', () => {
    expect(
      buildLogicalTerminalLines([
        { line: 10, text: '› 請幫我檢查很長的', isWrapped: false },
        { line: 11, text: '需求', isWrapped: true },
        { line: 12, text: '模型回答', isWrapped: false },
      ]),
    ).toEqual([
      { line: 10, text: '› 請幫我檢查很長的需求' },
      { line: 12, text: '模型回答' },
    ]);
  });
});

describe('matchCodexConversationNodes', () => {
  it('只建立 rollout 使用者文字的唯一 scrollback 命中', () => {
    const nodes = matchCodexConversationNodes(
      [{ index: 0, preview: '請檢查', matchText: '請檢查' }],
      [
        { line: 1, text: '模型回答很多字' },
        { line: 4, text: '  ›   請檢查  ' },
      ],
    );
    expect(nodes).toEqual([{ line: 4, preview: '請檢查', width: 16 }]);
  });

  it('相同文字重複或已不在 buffer 時 fail-closed 不建立假節點', () => {
    const prompt = [{ index: 0, preview: '重複問題', matchText: '重複問題' }];
    expect(
      matchCodexConversationNodes(prompt, [
        { line: 2, text: '› 重複問題' },
        { line: 8, text: '› 重複問題' },
      ]),
    ).toEqual([]);
    expect(matchCodexConversationNodes(prompt, [{ line: 9, text: '模型回答' }])).toEqual([]);
    expect(matchCodexConversationNodes(prompt, [{ line: 9, text: '重複問題' }])).toEqual([]);
  });

  it('依 rollout 順序單調配對不同提問', () => {
    const nodes = matchCodexConversationNodes(
      [
        { index: 0, preview: '第一問', matchText: '第一問' },
        { index: 1, preview: '第二問', matchText: '第二問' },
      ],
      [
        { line: 3, text: '› 第一問' },
        { line: 20, text: '› 第二問' },
      ],
    );
    expect(nodes.map((node) => node.line)).toEqual([3, 20]);
  });

  it('只選目前 scrollback 有最新唯一證據的 session', () => {
    const selected = selectCodexConversationSession(
      [
        { sessionId: 'external', nodes: [{ index: 0, preview: '外部問題', matchText: '外部問題' }] },
        { sessionId: 'current', nodes: [{ index: 0, preview: '目前問題', matchText: '目前問題' }] },
      ],
      [{ line: 12, text: '› 目前問題' }],
    );
    expect(selected).toEqual({
      sessionId: 'current',
      nodes: [{ line: 12, preview: '目前問題', width: 16 }],
    });
  });

  it('不同 session 證據同分時 fail-closed，且輸出遵守節點上限', () => {
    expect(
      selectCodexConversationSession(
        [
          { sessionId: 'a', nodes: [{ index: 0, preview: '同問', matchText: '同問' }] },
          { sessionId: 'b', nodes: [{ index: 0, preview: '同問', matchText: '同問' }] },
        ],
        [{ line: 7, text: '› 同問' }],
      ),
    ).toBeNull();

    expect(
      selectCodexConversationSession(
        [
          { sessionId: 'current', nodes: [{ index: 0, preview: '目前問題', matchText: '目前問題' }] },
          { sessionId: 'external', nodes: [{ index: 0, preview: '外部問題', matchText: '外部問題' }] },
        ],
        [
          { line: 10, text: '› 目前問題' },
          { line: 20, text: '› 外部問題' },
        ],
      ),
    ).toBeNull();

    const prompts = Array.from({ length: 5 }, (_, index) => ({
      index,
      preview: `問題${index}`,
      matchText: `問題${index}`,
    }));
    const lines = prompts.map((prompt, line) => ({ line, text: `› ${prompt.matchText}` }));
    expect(matchCodexConversationNodes(prompts, lines, 2).map((node) => node.preview)).toEqual(['問題3', '問題4']);
  });
});
