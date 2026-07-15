import { describe, it, expect } from 'vitest';
import { classifyPushError, classifyGhError, isNoUpstreamError } from './gitErrorClassify';

describe('isNoUpstreamError（自動 push -u 的觸發判定）', () => {
  it('git 各版措辭都認得', () => {
    expect(isNoUpstreamError('fatal: The current branch feat/x has no upstream branch.')).toBe(true);
    expect(isNoUpstreamError('There is no tracking information for the current branch.')).toBe(true);
  });
  it('其他錯誤不誤觸', () => {
    expect(isNoUpstreamError('fatal: repository not found')).toBe(false);
    expect(isNoUpstreamError('fatal: No configured push destination.')).toBe(false);
  });
});

describe('classifyPushError', () => {
  it('沒 remote → no-remote（dogfood 主病例）', () => {
    expect(classifyPushError('fatal: No configured push destination.\nEither specify the URL...', false)).toBe('no-remote');
    expect(classifyPushError("fatal: 'origin' does not appear to be a git repository", false)).toBe('no-remote');
  });
  it('GitHub 上 repo 不存在 → remote-not-found', () => {
    expect(classifyPushError("remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found", false)).toBe('remote-not-found');
  });
  it('認證/網路/逾時/其他', () => {
    expect(classifyPushError('fatal: Authentication failed for ...', false)).toBe('auth');
    expect(classifyPushError('git@github.com: Permission denied (publickey).', false)).toBe('auth');
    expect(classifyPushError("fatal: unable to access 'https://github.com/...': Could not resolve host: github.com", false)).toBe('network');
    expect(classifyPushError('whatever', true)).toBe('timeout');
    expect(classifyPushError('some unknown error', false)).toBe('failed');
  });
});

describe('classifyGhError', () => {
  it('名稱已存在 / 未登入 / 網路 / 逾時 / 其他', () => {
    expect(classifyGhError('GraphQL: Name already exists on this account (createRepository)', false)).toBe('name-exists');
    expect(classifyGhError('To get started with GitHub CLI, please run:  gh auth login', false)).toBe('gh-not-authed');
    expect(classifyGhError('error connecting to api.github.com', false)).toBe('network');
    expect(classifyGhError('anything', true)).toBe('timeout');
    expect(classifyGhError('boom', false)).toBe('failed');
  });
});
