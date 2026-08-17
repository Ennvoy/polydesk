import { describe, expect, it } from 'vitest';
import { cleanupCheckpointText } from './cleanupFeedback';

/** 後端實際會寫入 journal 的 checkpoint 全集（見 cleanup/local 與 cleanup/remote 的 checkpoint 呼叫）。 */
const CHECKPOINTS = [
  'worktree-removed:323dd3a8ff4f61759ef03bc08530ee47952cacd9044447ee4886ff97913db46b',
  'worktree-delisted-after-reconcile:323dd3a8ff4f61759ef03bc08530ee47952cacd9044447ee4886ff97913db46b',
  'worktree-delisted:323dd3a8ff4f61759ef03bc08530ee47952cacd9044447ee4886ff97913db46b',
  'worktree-stale-registration-removed:323dd3a8ff4f61759ef03bc08530ee47952cacd9044447ee4886ff97913db46b',
  'worktree-registration-reconciled:323dd3a8ff4f61759ef03bc08530ee47952cacd9044447ee4886ff97913db46b',
  'worktree-unlocked:323dd3a8ff4f61759ef03bc08530ee47952cacd9044447ee4886ff97913db46b',
  'switched:release/2026-08',
  'local-ref-deleted',
  'local-ref-restored-after-worktree-race',
  'branch-config-cleared',
  'branch-reflog-cleared',
  'remote:endpoint-deleted:endpoint-7f3a',
  'remote:tracking-deleted:refs/remotes/origin/profile',
  'remote:tracking-retained:refs/remotes/origin/profile',
];

describe('cleanupCheckpointText', () => {
  it('每個實際 checkpoint 都翻成白話，且不外洩 id、ref 或雜湊', () => {
    for (const checkpoint of CHECKPOINTS) {
      const text = cleanupCheckpointText(checkpoint);
      expect(text).not.toBe(checkpoint);
      expect(text).not.toMatch(/[0-9a-f]{8,}/); // 雜湊／endpoint id
      expect(text).not.toContain('refs/');
      expect(text).not.toContain('release/2026-08');
      expect(text).not.toContain(':');
    }
  });

  it('未知 checkpoint 回通用敘述，不把原字串丟到畫面', () => {
    expect(cleanupCheckpointText('brand-new-step:deadbeefdeadbeef')).toBe('已完成一個清理步驟');
  });

  it('可辨識的 checkpoint 各有專屬敘述', () => {
    expect(cleanupCheckpointText('local-ref-deleted')).toBe('已刪除本地分支 ref');
    expect(cleanupCheckpointText('worktree-removed:abc')).toBe('已移除 worktree 資料夾與登記');
    expect(cleanupCheckpointText('worktree-delisted-after-reconcile:abc')).toBe('已在收斂階段移除 worktree 登記');
  });
});
