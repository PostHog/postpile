import { describe, expect, it } from 'vitest';
import { mapTidyAnswer } from './tidy-answer.ts';
import { emptyContext, makePr, viewer } from './test-fixtures.ts';

const pr = (number: number) => makePr({ ref: { repo: 'acme/app', number } });
const input = {
  topics: [
    { id: 'a', name: 'A', goal: '', prs: [pr(1)] },
    { id: 'b', name: 'B', goal: '', prs: [pr(2)] },
    { id: 'c', name: 'C', goal: '', prs: [pr(3), pr(4)] },
  ],
  viewer,
  context: emptyContext,
};

describe('mapTidyAnswer', () => {
  it('keeps merges of known, distinct topics and never folds a target away', () => {
    const result = mapTidyAnswer(
      {
        merges: [
          { fromTopicIds: ['b', 'b', 'a', 'zz'], intoTopicId: 'a', name: ' Desktop app ', reason: 'one app' },
          { fromTopicIds: ['a'], intoTopicId: 'c', name: null, reason: 'target folded away' },
          { fromTopicIds: ['c'], intoTopicId: 'nope', name: null, reason: 'unknown target' },
        ],
        splits: [],
      },
      input,
    );
    expect(result.merges).toEqual([{ fromTopicIds: ['b'], intoTopicId: 'a', name: 'Desktop app', reason: 'one app' }]);
  });

  it('keeps splits of members that leave at least one PR behind, not of a folded topic', () => {
    const result = mapTidyAnswer(
      {
        merges: [{ fromTopicIds: ['b'], intoTopicId: 'a', name: null, reason: 'x' }],
        splits: [
          { topicId: 'c', prKeys: ['acme/app#4', 'acme/app#9'], reason: 'stray' },
          { topicId: 'c', prKeys: ['acme/app#3', 'acme/app#4'], reason: 'would empty it' },
          { topicId: 'b', prKeys: ['acme/app#2'], reason: 'folded away' },
        ],
      },
      input,
    );
    expect(result.splits).toEqual([{ topicId: 'c', prKeys: ['acme/app#4'], reason: 'stray' }]);
  });
});
