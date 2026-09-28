import { describe, expect, it } from 'vitest';
import { gitErrorDetail, gitErrorFeedback } from './gitErrorFeedback';

describe('Git 錯誤處理提示', () => {
  it('索引鎖定要求核對持有者，保留鎖定檔', () => {
    const feedback = gitErrorFeedback('Unable to create .git/index.lock: File exists. Another git process seems to be running');
    expect(feedback.summary).toBe('Git 正在被其他操作使用。');
    expect(feedback.nextStep).toContain('保留鎖定檔');
  });
  it('損壞 object 要求保留並備份 repository', () => {
    const feedback = gitErrorFeedback('fatal: bad object refs/heads/broken');
    expect(feedback.summary).toBe('Git 資料無法讀取。');
    expect(feedback.nextStep).toContain('備份 repository');
    expect(feedback.nextStep).toContain('保留原有 refs');
  });
  it('遠端不存在或不可存取時提示核對網址與權限', () => {
    const feedback = gitErrorFeedback('fatal: repository https://example.invalid/repo.git not found');
    expect(feedback.summary).toBe('遠端倉庫不存在或無權限。');
    expect(feedback.nextStep).toContain('存取權限');
  });
  it('tracked 與 untracked 覆蓋防護都要求先保存', () => {
    for (const text of ['Your local changes would be overwritten by merge', 'The following untracked working tree files would be overwritten by merge']) {
      expect(gitErrorFeedback(text).summary).toContain('Git 已停止');
      expect(gitErrorFeedback(text).nextStep).toContain('包含新檔');
    }
  });
  it('stash pop 衝突明確說明 stash 保留', () => {
    expect(gitErrorFeedback('CONFLICT (content): Merge conflict in app.txt').nextStep).toContain('原 stash 會保留');
  });
  it('分歧與不明錯誤不能被誤稱為本機檔案覆蓋', () => {
    expect(gitErrorFeedback('Need to specify how to reconcile divergent branches').summary).toContain('各有新提交');
    expect(gitErrorFeedback('custom hook failed').summary).toBe('Git 操作未完成。');
  });
  it('第二次 checkout 失敗仍告知變更已存入 stash', () => {
    expect(gitErrorFeedback('變更已暫存到 stash，但切換仍失敗：would be overwritten').summary).toContain('已存入 stash');
  });
  it('技術原文保留換行與 tab，中和終端控制與雙向字元', () => {
    expect(gitErrorDetail('line1\n\tline2\u001b\u202e')).toBe('line1\n\tline2��');
  });
  it('本機 Git 讀取逾時不會被說成網路問題', () => {
    const feedback = gitErrorFeedback('Git 本機操作逾時（10 秒）\nCommand failed: git status');
    expect(feedback.summary).toBe('Git 本機讀取或操作未完成。');
    expect(feedback.nextStep).not.toContain('VPN');
  });
  it('專用狀態讀取逾時提示檢查本機狀態', () => {
    const feedback = gitErrorFeedback('Git 狀態讀取逾時（30 秒）');
    expect(feedback.summary).toBe('Git 本機讀取或操作未完成。');
    expect(feedback.nextStep).toContain('repository');
    expect(feedback.nextStep).not.toContain('VPN');
  });
});
