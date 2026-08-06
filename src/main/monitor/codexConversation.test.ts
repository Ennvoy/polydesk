import { beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearCodexConversationCache,
  MAX_CODEX_CONVERSATION_NODES,
  parseCodexSessionMeta,
  parseCodexUserMessage,
  readCodexConversation,
  readCodexConversationById,
  readCodexConversations,
} from './codexConversation';

const now = new Date(2026, 7, 6, 12, 0, 0).getTime();
const jsonl = (value: unknown): string => `${JSON.stringify(value)}\n`;
const meta = (id: string, cwd: string, source: unknown = 'cli', originator = 'codex-tui'): string =>
  jsonl({ type: 'session_meta', payload: { id, cwd, source, originator } });
const user = (message: string): string => jsonl({ type: 'event_msg', payload: { type: 'user_message', message } });

describe('Codex conversation parser', () => {
  it('只接受互動式 codex-tui session meta', () => {
    expect(parseCodexSessionMeta(meta('s1', 'C:/p'))).toMatchObject({ id: 's1', cwd: 'C:/p' });
    expect(parseCodexSessionMeta(meta('s2', 'C:/p', { subagent: true }))).toBeNull();
    expect(parseCodexSessionMeta(meta('s3', 'C:/p', 'exec'))).toBeNull();
  });

  it('只取 event_msg/user_message，不取 injected response_item 或模型輸出', () => {
    expect(parseCodexUserMessage(user('我的提問'))).toBe('我的提問');
    expect(
      parseCodexUserMessage(jsonl({ type: 'response_item', payload: { type: 'message', role: 'user', content: '注入上下文' } })),
    ).toBeNull();
    expect(parseCodexUserMessage(jsonl({ type: 'event_msg', payload: { type: 'agent_message', message: '模型回覆' } }))).toBeNull();
  });
});

describe('readCodexConversation', () => {
  let root: string;
  let dayDir: string;
  const cwd = 'C:/work/project';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-codex-conversation-'));
    dayDir = join(root, '2026', '08', '06');
    mkdirSync(dayDir, { recursive: true });
    clearCodexConversationCache();
  });

  it('排除較新的 subagent rollout，讀出 TUI 的使用者文字', async () => {
    writeFileSync(join(dayDir, 'rollout-tui.jsonl'), meta('tui-1', cwd) + user('第一問') + jsonl({ type: 'event_msg', payload: { type: 'agent_message', message: '回答' } }));
    writeFileSync(join(dayDir, 'rollout-subagent.jsonl'), meta('sub-1', cwd, { subagent: true }) + user('不該出現'));

    const result = await readCodexConversation(cwd, root, now);
    expect(result?.sessionId).toBe('tui-1');
    expect(result?.nodes).toEqual([{ index: 0, preview: '第一問', matchText: '第一問' }]);
  });

  it('append 只加入新完整事件，半行完成前不建立節點', async () => {
    const path = join(dayDir, 'rollout-tui.jsonl');
    writeFileSync(path, meta('tui-1', cwd) + user('第一問'));
    expect((await readCodexConversation(cwd, root, now))?.nodes).toHaveLength(1);
    appendFileSync(path, '{"type":"event_msg","payload":{"type":"user_message","message":"第二');
    expect((await readCodexConversation(cwd, root, now))?.nodes).toHaveLength(1);
    appendFileSync(path, '問"}}\n');
    expect((await readCodexConversation(cwd, root, now))?.nodes.map((node) => node.preview)).toEqual(['第一問', '第二問']);
  });

  it('同 cwd 多個 TUI 不猜最新一個，交回候選並可沿用已綁定 session', async () => {
    writeFileSync(join(dayDir, 'rollout-current.jsonl'), meta('current', cwd) + user('目前問題'));
    writeFileSync(join(dayDir, 'rollout-external.jsonl'), meta('external', cwd) + user('外部問題'));

    expect(await readCodexConversation(cwd, root, now)).toBeNull();
    expect((await readCodexConversations(cwd, root, now)).map((session) => session.sessionId).sort()).toEqual([
      'current',
      'external',
    ]);
    expect((await readCodexConversationById(cwd, 'current'))?.nodes[0].preview).toBe('目前問題');
    expect(await readCodexConversationById('C:/other', 'current')).toBeNull();
  });

  it('長 session 只保留最近固定數量節點但維持原始序號', async () => {
    const path = join(dayDir, 'rollout-long.jsonl');
    const messages = Array.from({ length: MAX_CODEX_CONVERSATION_NODES + 3 }, (_, index) => user(`問題${index}`));
    writeFileSync(path, meta('long', cwd) + messages.join(''));

    const result = await readCodexConversation(cwd, root, now);
    expect(result?.nodes).toHaveLength(MAX_CODEX_CONVERSATION_NODES);
    expect(result?.nodes[0].index).toBe(3);
    expect(result?.nodes.at(-1)?.index).toBe(MAX_CODEX_CONVERSATION_NODES + 2);
  });
});
