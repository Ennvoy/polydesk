import { describe, expect, it } from 'vitest';
import { INVOKE_CHANNELS } from '../../src/shared/channels';

describe('AI 對話資料邊界', () => {
  it('不再向 renderer 暴露 Claude 或 Codex 對話讀取通道', () => {
    expect(INVOKE_CHANNELS).not.toContain('ai:conversation');
  });
});
