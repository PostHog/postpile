import { describe, expect, it } from 'vitest';
import { at } from './fixtures.ts';
import { isRetiredSince, nextTopicStatus } from './topic-status.ts';
import type { TopicStatus } from './types.ts';

const WHEN = at(30);

describe('nextTopicStatus', () => {
  it('retires only an active topic, and records when', () => {
    expect(nextTopicStatus({ status: 'active' }, 'retire', WHEN)).toEqual({ status: 'retired', retiredAt: WHEN });
    expect(nextTopicStatus({ status: 'retired' }, 'retire', WHEN)).toBeNull();
    expect(nextTopicStatus({ status: 'archived' }, 'retire', WHEN)).toBeNull();
  });

  it('revives only a retired topic, and clears the retire time', () => {
    expect(nextTopicStatus({ status: 'retired' }, 'revive', WHEN)).toEqual({ status: 'active', retiredAt: null });
    expect(nextTopicStatus({ status: 'active' }, 'revive', WHEN)).toBeNull();
    expect(nextTopicStatus({ status: 'archived' }, 'revive', WHEN)).toBeNull();
  });

  it('archives an active or retired topic, never one archived already', () => {
    for (const status of ['active', 'retired'] as TopicStatus[]) {
      expect(nextTopicStatus({ status }, 'archive', WHEN)).toEqual({ status: 'archived', retiredAt: null });
    }
    expect(nextTopicStatus({ status: 'archived' }, 'archive', WHEN)).toBeNull();
  });
});

describe('isRetiredSince', () => {
  it('counts a topic retired at or after the time', () => {
    expect(isRetiredSince({ status: 'retired', retiredAt: at(30) }, at(30))).toBe(true);
    expect(isRetiredSince({ status: 'retired', retiredAt: at(31) }, at(30))).toBe(true);
    expect(isRetiredSince({ status: 'retired', retiredAt: at(29) }, at(30))).toBe(false);
  });

  it('never counts a topic that is not retired or has no retire time', () => {
    expect(isRetiredSince({ status: 'active', retiredAt: at(31) }, at(30))).toBe(false);
    expect(isRetiredSince({ status: 'archived', retiredAt: at(31) }, at(30))).toBe(false);
    expect(isRetiredSince({ status: 'retired', retiredAt: null }, at(30))).toBe(false);
  });
});
