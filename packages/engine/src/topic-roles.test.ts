import { makePr } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
import { topicDriver, userRoleFor } from './topic-roles.ts';

describe('topicDriver', () => {
  it('picks the most frequent author', () => {
    const prs = [makePr({ number: 1, author: 'a' }), makePr({ number: 2, author: 'b' }), makePr({ number: 3, author: 'b' })];
    expect(topicDriver(prs)).toBe('b');
  });

  it('returns null without authors', () => {
    expect(topicDriver([])).toBeNull();
  });
});

describe('userRoleFor', () => {
  it('is driver when the user drives it', () => {
    expect(userRoleFor('me', 'me', ['review_requested'])).toBe('driver');
  });

  it('prefers reviewer over stakeholder', () => {
    expect(userRoleFor('me', 'bob', ['mention', 'review_requested'])).toBe('reviewer');
    expect(userRoleFor('me', 'bob', ['mention'])).toBe('stakeholder');
    expect(userRoleFor('me', 'bob', ['subscribed'])).toBe('watcher');
  });
});
