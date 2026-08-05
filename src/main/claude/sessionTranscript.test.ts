import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claudeProjectSlug,
  parseTranscriptLine,
  buildTranscriptNodes,
  readClaudeTranscript,
  clearTranscriptCache,
} from './sessionTranscript';

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
const userLine = (text: string): string =>
  line({ type: 'user', isSidechain: false, message: { content: [{ type: 'text', text }] } });
const assistantLine = (text: string): string =>
  line({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'text', text }] } });

describe('claudeProjectSlug', () => {
  it('把非英數字元逐字換成 dash（對齊 claude 自己的目錄命名）', () => {
    expect(claudeProjectSlug('C:\\Users\\ennvoy.lin\\Documents\\我的終端機')).toBe(
      'C--Users-ennvoy-lin-Documents------',
    );
  });
});

describe('parseTranscriptLine', () => {
  it('取出使用者提問與 Claude 回覆', () => {
    expect(parseTranscriptLine(userLine('幫我修導覽軌'))).toEqual({ role: 'user', preview: '幫我修導覽軌' });
    expect(parseTranscriptLine(assistantLine('好的，我先看程式碼'))).toEqual({
      role: 'assistant',
      preview: '好的，我先看程式碼',
    });
  });

  it('排除 tool_result 回填、sidechain、isMeta 與 slash 指令 stdout', () => {
    expect(
      parseTranscriptLine(
        line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } }),
      ),
    ).toBeNull();
    expect(parseTranscriptLine(line({ type: 'user', isSidechain: true, message: { content: [{ type: 'text', text: 'x' }] } }))).toBeNull();
    expect(parseTranscriptLine(line({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'x' }] } }))).toBeNull();
    expect(
      parseTranscriptLine(line({ type: 'user', message: { content: [{ type: 'text', text: '<local-command-stdout>ok</local-command-stdout>' }] } })),
    ).toBeNull();
  });

  it('只有 thinking / tool_use 的 assistant 回合不建節點', () => {
    expect(
      parseTranscriptLine(line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '想一下' }] } })),
    ).toBeNull();
    expect(
      parseTranscriptLine(line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } })),
    ).toBeNull();
  });

  it('剝掉 system-reminder 與標籤，壓成單行', () => {
    const entry = parseTranscriptLine(userLine('前面\n<system-reminder>吵死了</system-reminder>\n後面'));
    expect(entry).toEqual({ role: 'user', preview: '前面 後面' });
  });

  it('非訊息行與壞行不讓整條軸崩掉', () => {
    expect(parseTranscriptLine('{壞掉的 json')).toBeNull();
    expect(parseTranscriptLine(line({ type: 'file-history-snapshot' }))).toBeNull();
  });
});

describe('buildTranscriptNodes', () => {
  it('promptsFromEnd 是「往回數幾個 user prompt」，最新那則為 0', () => {
    const nodes = buildTranscriptNodes([
      { role: 'user', preview: '第一問' },
      { role: 'assistant', preview: '第一答' },
      { role: 'user', preview: '第二問' },
      { role: 'assistant', preview: '第二答' },
      { role: 'user', preview: '第三問' },
    ]);
    expect(nodes.map((n) => n.promptsFromEnd)).toEqual([2, 2, 1, 1, 0]);
    expect(nodes.map((n) => n.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('同一回合的連續發言摺疊成一個節點（它們都只能跳到同一個 prompt）', () => {
    const nodes = buildTranscriptNodes([
      { role: 'user', preview: '幫我查' },
      { role: 'assistant', preview: '我先看程式碼' },
      { role: 'assistant', preview: '再確認一下' },
      { role: 'assistant', preview: '找到了' },
      { role: 'user', preview: '那修一下' },
    ]);
    expect(nodes.map((n) => [n.role, n.preview])).toEqual([
      ['user', '幫我查'],
      ['assistant', '我先看程式碼'],
      ['user', '那修一下'],
    ]);
    expect(nodes.map((n) => n.promptsFromEnd)).toEqual([1, 1, 0]);
  });

  it('空對話回空陣列', () => {
    expect(buildTranscriptNodes([])).toEqual([]);
  });
});

describe('readClaudeTranscript', () => {
  let home: string;
  const cwd = 'C:\\Users\\tester\\proj';
  const dir = (): string => join(home, '.claude', 'projects', claudeProjectSlug(cwd));

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pd-transcript-'));
    mkdirSync(dir(), { recursive: true });
    clearTranscriptCache();
  });

  it('沒跑過 claude 的專案回 null（renderer 據此保留行導覽軌）', async () => {
    expect(await readClaudeTranscript('C:\\Users\\tester\\other', home)).toBeNull();
  });

  it('讀出 session id 與訊息節點', async () => {
    writeFileSync(join(dir(), 'sess-a.jsonl'), userLine('問題一') + assistantLine('回答一'));
    const transcript = await readClaudeTranscript(cwd, home);
    expect(transcript?.sessionId).toBe('sess-a');
    expect(transcript?.nodes.map((n) => [n.role, n.preview])).toEqual([
      ['user', '問題一'],
      ['assistant', '回答一'],
    ]);
  });

  it('append 後只讀新增段落，且結果與整份重讀一致', async () => {
    const path = join(dir(), 'sess-a.jsonl');
    writeFileSync(path, userLine('問題一') + assistantLine('回答一'));
    await readClaudeTranscript(cwd, home);
    appendFileSync(path, userLine('問題二') + assistantLine('回答二'));
    const incremental = await readClaudeTranscript(cwd, home);

    clearTranscriptCache();
    const full = await readClaudeTranscript(cwd, home);
    expect(incremental).toEqual(full);
    expect(incremental?.nodes).toHaveLength(4);
    expect(incremental?.nodes.map((n) => n.promptsFromEnd)).toEqual([1, 1, 0, 0]);
  });

  it('寫到一半的半行不會被當成訊息，補完後才出現', async () => {
    const path = join(dir(), 'sess-a.jsonl');
    writeFileSync(path, userLine('完整的一則'));
    appendFileSync(path, '{"type":"assistant","message":{"content":[{"type":"text","text":"寫一半');
    expect((await readClaudeTranscript(cwd, home))?.nodes).toHaveLength(1);

    appendFileSync(path, '的回覆"}]}}\n');
    expect((await readClaudeTranscript(cwd, home))?.nodes.map((n) => n.preview)).toEqual([
      '完整的一則',
      '寫一半的回覆',
    ]);
  });

  it('換到更新的 session 檔時整份重讀，不接在舊對話後面', async () => {
    writeFileSync(join(dir(), 'sess-a.jsonl'), userLine('舊 session'));
    await readClaudeTranscript(cwd, home);

    const newer = join(dir(), 'sess-b.jsonl');
    writeFileSync(newer, userLine('新 session'));
    const future = new Date(Date.now() + 5_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(newer, future, future);

    const transcript = await readClaudeTranscript(cwd, home);
    expect(transcript?.sessionId).toBe('sess-b');
    expect(transcript?.nodes.map((n) => n.preview)).toEqual(['新 session']);
  });
});
