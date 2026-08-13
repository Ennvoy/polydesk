import { describe, expect, it } from 'vitest';
import { endpointDisplay, endpointFingerprint, normalizeEndpoint, redactRemoteError } from './remoteIdentity';

describe('遠端 endpoint 去密身分', () => {
  it('credential 不影響 fingerprint，顯示內容不含帳密', () => {
    const authenticated = 'https://alice:super-secret@example.com/team/repo.git';
    const anonymous = 'https://example.com/team/repo.git';
    expect(endpointFingerprint(authenticated)).toBe(endpointFingerprint(anonymous));
    expect(endpointDisplay(authenticated)).toBe('example.com/…/repo.git');
    const error = redactRemoteError(`fatal: unable to access '${authenticated}?token=abc123'`, authenticated);
    expect(error).not.toContain('alice');
    expect(error).not.toContain('super-secret');
    expect(error).not.toContain('abc123');
  });

  it('Windows drive path 不會被誤判成 scp endpoint', () => {
    expect(normalizeEndpoint('C:\\repos\\remote.git')).not.toMatch(/^ssh:/);
    expect(endpointDisplay('C:\\repos\\remote.git')).toBe('本機/…/remote.git');
  });
});
