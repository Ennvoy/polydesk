import { describe, expect, it } from 'vitest';
import { analyzeTrackingRefs, canonicalRefspecDigest, parseFetchRefspecConfig } from './refspecMapping';

describe('fetch refspec producer 分析', () => {
  it('解析含斜線 remote 名稱的 NUL config，並產生穩定 digest', () => {
    const raw = 'remote.team/upstream.fetch\n+refs/heads/*:refs/remotes/team/upstream/*\0';
    const records = parseFetchRefspecConfig(raw);
    expect(records).toEqual([{
      remote: 'team/upstream',
      refspec: '+refs/heads/*:refs/remotes/team/upstream/*',
    }]);
    expect(canonicalRefspecDigest(records)).toBe(canonicalRefspecDigest([...records]));
  });

  it('預設 mapping 只產生單一 refs/remotes producer', () => {
    const result = analyzeTrackingRefs(
      [{ remote: 'origin', refspec: '+refs/heads/*:refs/remotes/origin/*' }],
      [{ remote: 'origin', branch: 'profile' }],
    );
    expect(result).toEqual([{
      localRef: 'refs/remotes/origin/profile',
      producers: [{
        remote: 'origin',
        sourceRef: 'refs/heads/profile',
        refspec: '+refs/heads/*:refs/remotes/origin/*',
      }],
      negativeOrAmbiguous: false,
      namespaceAllowed: true,
    }]);
  });

  it('自訂非 tracking namespace、負 refspec 與重疊 producer 一律保留', () => {
    const custom = analyzeTrackingRefs(
      [{ remote: 'origin', refspec: '+refs/heads/*:refs/cache/*' }],
      [{ remote: 'origin', branch: 'profile' }],
    );
    expect(custom[0]).toMatchObject({ localRef: 'refs/cache/profile', namespaceAllowed: false });

    const negative = analyzeTrackingRefs([
      { remote: 'origin', refspec: '+refs/heads/*:refs/remotes/shared/*' },
      { remote: 'origin', refspec: '^refs/heads/profile' },
    ], [{ remote: 'origin', branch: 'profile' }]);
    expect(negative[0]?.negativeOrAmbiguous).toBe(true);

    const overlap = analyzeTrackingRefs([
      { remote: 'origin', refspec: '+refs/heads/*:refs/remotes/shared/*' },
      { remote: 'backup', refspec: '+refs/heads/*:refs/remotes/shared/*' },
    ], [
      { remote: 'origin', branch: 'profile' },
      { remote: 'backup', branch: 'profile' },
    ]);
    expect(overlap[0]).toMatchObject({ negativeOrAmbiguous: true });
    expect(overlap[0]?.producers).toHaveLength(2);
  });
});
