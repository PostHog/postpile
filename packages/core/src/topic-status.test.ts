import { describe, expect, it } from 'vitest';
import { at } from './fixtures.ts';
import { lastJoinAt, nextTopicStatus, takesNewPrs } from './topic-status.ts';
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

const DAY = 24 * 60;

/** `at` counts minutes; these tests count days. */
function day(n: number): string {
  return at(n * DAY);
}

describe('takesNewPrs', () => {
  it('always for an active topic, never for one merged away', () => {
    expect(takesNewPrs({ status: 'active', kind: 'project', retiredAt: null }, null, new Date(day(400)))).toBe(true);
    expect(takesNewPrs({ status: 'archived', kind: 'standing', retiredAt: null }, day(1), new Date(day(2)))).toBe(false);
  });

  it('takes a late follow-up for a project in the Archive for 30 days', () => {
    const project = { status: 'retired', kind: 'project', retiredAt: day(0) } as const;
    expect(takesNewPrs(project, day(0), new Date(day(29)))).toBe(true);
    expect(takesNewPrs(project, day(0), new Date(day(31)))).toBe(false);
  });

  it('keeps a standing topic until half a year passed without a PR joining', () => {
    const standing = { status: 'retired', kind: 'standing', retiredAt: day(100) } as const;
    expect(takesNewPrs(standing, day(90), new Date(day(260)))).toBe(true);
    expect(takesNewPrs(standing, day(90), new Date(day(275)))).toBe(false);
    // Without a join on record, the time it went to the Archive counts.
    expect(takesNewPrs(standing, null, new Date(day(270)))).toBe(true);
  });
});

describe('lastJoinAt', () => {
  it('is the newest join, or null for an empty topic', () => {
    expect(lastJoinAt([{ createdAt: day(3) }, { createdAt: day(9) }, { createdAt: day(5) }])).toBe(day(9));
    expect(lastJoinAt([])).toBeNull();
  });
});
