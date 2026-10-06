import { describe, expect, it } from 'vitest';
import { excludedTopicIds, type TopicMergeLink } from './topic-exclusions.ts';
import type { Feedback, FeedbackKind } from './types.ts';

function said(kind: FeedbackKind, topicId: string | null): Pick<Feedback, 'kind' | 'topicId'> {
  return { kind, topicId };
}

function merged(topicId: string, intoTopicId: string): TopicMergeLink {
  return { topicId, intoTopicId };
}

describe('excludedTopicIds', () => {
  it('excludes every topic the user took the PR out of', () => {
    expect(excludedTopicIds([said('wrong_topic', 'billing'), said('wrong_topic', 'depot')], [])).toEqual(new Set(['billing', 'depot']));
  });

  it('excludes nothing without a "Wrong topic"', () => {
    expect(excludedTopicIds([], [merged('billing', 'payments')])).toEqual(new Set());
  });

  it('only counts "Wrong topic", and only out of a real topic', () => {
    const feedback = [said('not_mine', 'billing'), said('not_related', 'depot'), said('wrong_topic', null)];

    expect(excludedTopicIds(feedback, [])).toEqual(new Set());
  });

  it('follows the topic into the one it was merged into, through a chain', () => {
    const merges = [merged('payments', 'money'), merged('billing', 'payments'), merged('depot', 'ci')];

    expect(excludedTopicIds([said('wrong_topic', 'billing')], merges)).toEqual(new Set(['billing', 'payments', 'money']));
  });

  it('does not follow a merge into the excluded topic the other way', () => {
    expect(excludedTopicIds([said('wrong_topic', 'billing')], [merged('payments', 'billing')])).toEqual(new Set(['billing']));
  });

  it('stops on merges that point back at each other', () => {
    const merges = [merged('billing', 'payments'), merged('payments', 'billing')];

    expect(excludedTopicIds([said('wrong_topic', 'billing')], merges)).toEqual(new Set(['billing', 'payments']));
  });

  it('skips merge rows without both topics', () => {
    expect(excludedTopicIds([said('wrong_topic', 'billing')], [{ topicId: 'billing', intoTopicId: null }])).toEqual(new Set(['billing']));
  });
});
