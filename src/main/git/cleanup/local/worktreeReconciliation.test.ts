import { describe, expect, it } from 'vitest';
import { decideWorktreeReconciliation } from './LocalCleanupExecutor';

describe('worktree path/Git/Polydesk 八態 reconciliation', () => {
  it.each([
    [true, true, true, 'freeze-retry'],
    [true, true, false, 'freeze-retry'],
    [true, false, true, 'delist-preserve-path'],
    [true, false, false, 'manual-preserve-path'],
    [false, true, true, 'remove-registration-and-delist'],
    [false, true, false, 'remove-registration'],
    [false, false, true, 'delist-complete'],
    [false, false, false, 'complete'],
  ] as const)('path=%s Git=%s Polydesk=%s → %s', (pathExists, gitRegistered, polydeskRegistered, expected) => {
    expect(decideWorktreeReconciliation(pathExists, gitRegistered, polydeskRegistered)).toBe(expected);
  });
});
