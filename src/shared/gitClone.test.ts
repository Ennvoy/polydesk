import { describe, expect, it } from 'vitest';
import { cloneDirectoryNameError, cloneDirectoryNameFromUrl, cloneUrlError, isGitHubHttpsCloneUrl } from './gitClone';

describe('git clone 輸入規則', () => {
  it('接受 HTTPS、SSH URL 與 scp-like SSH', () => {
    expect(cloneUrlError('https://github.com/openai/codex.git')).toBeNull();
    expect(cloneUrlError('ssh://git@github.com/openai/codex.git')).toBeNull();
    expect(cloneUrlError('git@github.com:openai/codex.git')).toBeNull();
  });

  it('拒絕 URL 內嵌憑證、自訂 helper 與本機路徑', () => {
    expect(cloneUrlError('https://token@github.com/openai/codex.git')).toContain('Token');
    expect(cloneUrlError('ext::sh -c evil')).not.toBeNull();
    expect(cloneUrlError('http://example.com/open/repo.git')).not.toBeNull();
    expect(cloneUrlError('git://example.com/open/repo.git')).not.toBeNull();
    expect(cloneUrlError('C:\\repo')).not.toBeNull();
  });

  it('只把 github.com HTTPS URL 導向 GitHub 帳號登入流程', () => {
    expect(isGitHubHttpsCloneUrl('https://github.com/openai/codex.git')).toBe(true);
    expect(isGitHubHttpsCloneUrl('https://GITHUB.COM/openai/codex')).toBe(true);
    expect(isGitHubHttpsCloneUrl('git@github.com:openai/codex.git')).toBe(false);
    expect(isGitHubHttpsCloneUrl('https://gitlab.com/openai/codex.git')).toBe(false);
  });

  it('從常見 URL 推導資料夾名稱', () => {
    expect(cloneDirectoryNameFromUrl('https://github.com/openai/codex.git')).toBe('codex');
    expect(cloneDirectoryNameFromUrl('git@github.com:openai/codex.git')).toBe('codex');
  });

  it('資料夾名稱不可跳脫父目錄或使用 Windows 保留名', () => {
    expect(cloneDirectoryNameError('repo')).toBeNull();
    expect(cloneDirectoryNameError('../repo')).not.toBeNull();
    expect(cloneDirectoryNameError('CON')).not.toBeNull();
    expect(cloneDirectoryNameError('repo.')).not.toBeNull();
  });
});
