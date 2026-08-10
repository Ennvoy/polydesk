import { describe, expect, it } from 'vitest';
import { migrate, sanitizeOnboardingState } from './schema';

describe('onboarding schema', () => {
  it('保留合法的版本化進度與完成狀態', () => {
    expect(sanitizeOnboardingState({ version: 1, status: 'in-progress', step: 4 })).toEqual({
      version: 1,
      status: 'in-progress',
      step: 4,
    });
    expect(migrate({ schemaVersion: 3, onboarding: { version: 1, status: 'completed', step: 0 } }).onboarding).toEqual({
      version: 1,
      status: 'completed',
      step: 0,
    });
  });

  it.each([
    null,
    { version: -1, status: 'in-progress', step: 2 },
    { version: 1.5, status: 'completed', step: 0 },
    { version: 1, status: 'unknown', step: 0 },
    { version: 1, status: 'in-progress', step: -1 },
    { version: 1, status: 'in-progress', step: 2.5 },
  ])('壞值 %j 退回安全的未開始狀態', (value) => {
    expect(sanitizeOnboardingState(value)).toEqual({ version: 0, status: 'not-started', step: 0 });
  });

  it('schema v2 遷移時不沿用未知的舊導覽欄位', () => {
    const state = migrate({
      schemaVersion: 2,
      onboarding: { version: 99, status: 'completed', step: 6 },
    });
    expect(state.schemaVersion).toBe(3);
    expect(state.onboarding).toEqual({ version: 0, status: 'not-started', step: 0 });
  });
});
