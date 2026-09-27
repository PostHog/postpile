import { describe, expect, it } from 'vitest';
import { isEmptyDelta } from './delta.ts';
import type { TopicDelta } from './memory.ts';

const empty: TopicDelta = {
  topicId: 'ci',
  fromSeq: 10,
  toSeq: 10,
  events: [],
  omittedEvents: 0,
  joinedPrKeys: [],
  leftPrKeys: [],
  staleFactIds: [],
  staleClaims: [],
  newFeedback: [],
};

describe('isEmptyDelta', () => {
  it('is empty only when nothing at all is new', () => {
    expect(isEmptyDelta(empty)).toBe(true);
    expect(isEmptyDelta({ ...empty, joinedPrKeys: ['a/b#1'] })).toBe(false);
    expect(isEmptyDelta({ ...empty, staleFactIds: ['f1'] })).toBe(false);
    expect(isEmptyDelta({ ...empty, omittedEvents: 3 })).toBe(false);
  });
});
