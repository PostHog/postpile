import { describe, expect, it } from 'vitest';
import { setChangeText } from './set-history.ts';

describe('setChangeText', () => {
  it('names the PR, the change, who made it and why', () => {
    const change = { setId: 's1', topicId: 't1', prKey: 'acme/app#2', kind: 'joined' as const, reason: 'same cap', by: 'agent' as const, at: '2026-10-01T09:15:00.000Z' };
    expect(setChangeText(change)).toBe('2026-10-01 acme/app#2 joined (agent): same cap');
    expect(setChangeText({ ...change, prKey: null, kind: 'ended', reason: 'fewer than two PRs left', by: 'user' })).toBe(
      '2026-10-01 set ended (user): fewer than two PRs left',
    );
  });
});
