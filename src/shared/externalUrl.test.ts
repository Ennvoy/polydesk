import { describe, expect, it } from 'vitest';
import { isSafeExternalHttpUrl, normalizeExternalHttpUrl } from './externalUrl';

describe('外部 HTTP(S) 網址白名單', () => {
  it('接受一般 HTTPS 與 localhost HTTP，並正規化網址', () => {
    expect(normalizeExternalHttpUrl('https://example.com/docs?q=terminal#link')).toBe(
      'https://example.com/docs?q=terminal#link',
    );
    expect(normalizeExternalHttpUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it('拒絕非 HTTP(S)、控制字元、缺少主機與內嵌帳密', () => {
    for (const value of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'data:text/html,unsafe',
      'https://user:token@example.com/private',
      'https://example.com/ok\nfile:///C:/unsafe',
      'http:///missing-host',
    ]) {
      expect(isSafeExternalHttpUrl(value), value).toBe(false);
    }
  });
});
