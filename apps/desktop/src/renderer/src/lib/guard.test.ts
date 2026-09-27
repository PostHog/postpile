import { describe, expect, it } from 'vitest';
import { writeBlockedReason } from './guard.ts';

describe('writeBlockedReason', () => {
  it('blocks GitHub writes unless the server allows them', () => {
    expect(writeBlockedReason('approve', { fake: false, writesAllowed: false })).toMatch(/CODE_MANAGER_ALLOW_WRITES=1/);
    expect(writeBlockedReason('approve', { fake: false, writesAllowed: true })).toBeNull();
  });

  it('blocks while the config is still loading', () => {
    expect(writeBlockedReason('markRead', undefined)).toMatch(/until the app config has loaded/);
  });
});
