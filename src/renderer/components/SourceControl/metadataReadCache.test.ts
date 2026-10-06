import { describe, expect, it } from 'vitest';
import { reuseMetadataRead, type MetadataRead } from './metadataReadCache';

function read(): MetadataRead {
  return { wsId: 'ws', revision: 2, head: undefined, branch: undefined, expiresAt: 3_000 };
}

describe('SCM 歷史與分支短期讀取', () => {
  it('初次 status 回來不重讀，接著 ref 變更會失效', () => {
    const current = read();
    expect(reuseMetadataRead(current, 'ws', 2, null, 1_000)).toBe(true);
    expect(reuseMetadataRead(current, 'ws', 2, { head: 'aaa', branch: 'main' }, 1_000)).toBe(true);
    expect(current).toMatchObject({ head: 'aaa', branch: 'main' });
    expect(reuseMetadataRead(current, 'ws', 2, { head: 'bbb', branch: 'main' }, 1_000)).toBe(false);
    expect(reuseMetadataRead(current, 'ws', 2, { head: 'aaa', branch: 'other' }, 1_000)).toBe(false);
  });

  it('工作區、明確刷新世代與短期限都會失效', () => {
    const current = read();
    expect(reuseMetadataRead(current, 'other', 2, null, 1_000)).toBe(false);
    expect(reuseMetadataRead(current, 'ws', 3, null, 1_000)).toBe(false);
    expect(reuseMetadataRead(current, 'ws', 2, null, 3_000)).toBe(false);
    expect(reuseMetadataRead(current, 'ws', 2, null, 2_999)).toBe(true);
  });
});
