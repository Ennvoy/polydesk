// X-4 REQ-SEC-002：共用 spawn 環境清洗的白名單/denylist 單元測試。
import { describe, it, expect } from 'vitest';
import { buildSpawnEnv, sanitizeUserEnv } from '../../src/main/security/spawnEnv';

const DANGEROUS = {
  GIT_EXTERNAL_DIFF: 'node evil.js', // diff 時可達 RCE
  GIT_SSH_COMMAND: 'evil',
  GIT_PROXY_COMMAND: 'evil',
  GIT_ASKPASS: 'evil',
  GIT_CONFIG_COUNT: '9',
  GIT_CONFIG_KEY_0: 'core.pager',
  RIPGREP_CONFIG_PATH: 'evil',
  FOO_TOKEN: 'secret',
  MY_SECRET: 'secret',
  AWS_SECRET_ACCESS_KEY: 'secret',
  NODE_OPTIONS: '--require evil.js',
  ELECTRON_RUN_AS_NODE: '1',
  PLAYWRIGHT_MCP_FOO: 'x',
  RANDOM_INHERITED: 'r',
};

describe('buildSpawnEnv（白名單最小 env，給 git/lsp/搜尋/安裝）', () => {
  const source = {
    PATH: '/usr/bin',
    PATHEXT: '.EXE',
    SystemRoot: 'C:\\Windows',
    windir: 'C:\\Windows',
    HOME: '/home/u',
    USERPROFILE: 'C:\\Users\\u',
    APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
    LANG: 'en_US.UTF-8',
    ...DANGEROUS,
  };

  it('排除所有危險繼承變數（GIT_*/機密/注入向量/無關變數）', () => {
    const env = buildSpawnEnv({}, source);
    for (const k of Object.keys(DANGEROUS)) {
      expect(env[k], `${k} 不該洩漏`).toBeUndefined();
    }
  });

  it('保留白名單安全基礎變數（git 找得到 ssh/credential、global config 可讀）', () => {
    const env = buildSpawnEnv({}, source);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.SystemRoot).toBe('C:\\Windows');
    expect(env.HOME).toBe('/home/u');
    expect(env.USERPROFILE).toBe('C:\\Users\\u');
    expect(env.APPDATA).toBe('C:\\Users\\u\\AppData\\Roaming');
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('extra 疊加並覆蓋（如 LSP 的 GOTOOLCHAIN）', () => {
    const env = buildSpawnEnv({ GOTOOLCHAIN: 'local' }, source);
    expect(env.GOTOOLCHAIN).toBe('local');
    expect(env.GIT_EXTERNAL_DIFF).toBeUndefined(); // 仍不漏
  });
});

describe('sanitizeUserEnv（PTY denylist，給使用者 shell）', () => {
  it('剔除 Electron/Node 注入向量，保留使用者其餘環境（含其自己的 GIT_*/token）', () => {
    const source = {
      PATH: '/b',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require x',
      GIT_SSH_COMMAND: 'user-own-ssh', // 使用者自己的（其終端機）→ 保留
      MY_TOKEN: 't',
      CUSTOM_VAR: 'v',
    };
    const env = sanitizeUserEnv({}, source);
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PATH).toBe('/b');
    expect(env.GIT_SSH_COMMAND).toBe('user-own-ssh');
    expect(env.MY_TOKEN).toBe('t');
    expect(env.CUSTOM_VAR).toBe('v');
  });
});
