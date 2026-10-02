import { describe, expect, it } from 'vitest';
import { mapTidyAnswer } from './tidy-answer.ts';
import { emptyContext, makePr, viewer } from './test-fixtures.ts';

const pr = (number: number) => makePr({ ref: { repo: 'acme/app', number } });
const input = {
  topics: [
    { id: 'a', name: 'A', kind: 'project' as const, inArchive: false, goal: '', prs: [pr(1)] },
    { id: 'b', name: 'B', kind: 'project' as const, inArchive: false, goal: '', prs: [pr(2)] },
    { id: 'c', name: 'C', kind: 'project' as const, inArchive: true, goal: '', prs: [pr(3), pr(4)] },
  ],
  viewer,
  context: emptyContext,
};

type Answer = Parameters<typeof mapTidyAnswer>[0];

/** An answer with only the given parts; the rest empty, as the schema defaults them. */
function answer(parts: Partial<Answer>): Answer {
  return { merges: [], splits: [], renames: [], kinds: [], ...parts };
}

describe('mapTidyAnswer', () => {
  it('keeps merges of known, distinct topics and never folds a target away', () => {
    const result = mapTidyAnswer(
      answer({
        merges: [
          { fromTopicIds: ['b', 'b', 'a', 'zz'], intoTopicId: 'a', name: ' Desktop app ', reason: 'one app' },
          { fromTopicIds: ['a'], intoTopicId: 'c', name: null, reason: 'target folded away' },
          { fromTopicIds: ['c'], intoTopicId: 'nope', name: null, reason: 'unknown target' },
        ],
      }),
      input,
    );
    expect(result.merges).toEqual([{ fromTopicIds: ['b'], intoTopicId: 'a', name: 'Desktop app', reason: 'one app' }]);
  });

  it('keeps splits of members that leave at least one PR behind, not of a folded topic', () => {
    const result = mapTidyAnswer(
      answer({
        merges: [{ fromTopicIds: ['b'], intoTopicId: 'a', name: null, reason: 'x' }],
        splits: [
          { topicId: 'c', prKeys: ['acme/app#4', 'acme/app#9'], intoTopicId: 'a', newName: null, newKind: 'project', reason: 'stray' },
          { topicId: 'c', prKeys: ['acme/app#3', 'acme/app#4'], intoTopicId: 'a', newName: null, newKind: 'project', reason: 'would empty it' },
          { topicId: 'b', prKeys: ['acme/app#2'], intoTopicId: null, newName: 'Billing', newKind: 'project', reason: 'folded away' },
        ],
      }),
      input,
    );
    expect(result.splits).toEqual([{ topicId: 'c', prKeys: ['acme/app#4'], into: { kind: 'existing', topicId: 'a' }, reason: 'stray' }]);
  });

  it('counts every split entry of a topic together, so they cannot empty it', () => {
    const result = mapTidyAnswer(
      answer({
        splits: [
          { topicId: 'c', prKeys: ['acme/app#3'], intoTopicId: null, newName: 'Billing rewrite', newKind: 'project', reason: 'first' },
          { topicId: 'c', prKeys: ['acme/app#4'], intoTopicId: null, newName: 'Billing rewrite', newKind: 'project', reason: 'second would empty it' },
        ],
      }),
      input,
    );
    expect(result.splits).toEqual([{ topicId: 'c', prKeys: ['acme/app#3'], into: { kind: 'new', name: 'Billing rewrite', topicKind: 'project' }, reason: 'first' }]);
  });

  it('drops a split without a usable destination', () => {
    const result = mapTidyAnswer(
      answer({
        splits: [
          { topicId: 'c', prKeys: ['acme/app#3'], intoTopicId: 'c', newName: null, newKind: 'project', reason: 'into itself' },
          { topicId: 'c', prKeys: ['acme/app#3'], intoTopicId: 'zz', newName: '  ', newKind: 'project', reason: 'unknown and blank' },
          { topicId: 'c', prKeys: ['acme/app#3'], intoTopicId: 'zz', newName: 'Billing', newKind: 'project', reason: 'unknown id, a name' },
        ],
      }),
      input,
    );
    expect(result.splits).toEqual([{ topicId: 'c', prKeys: ['acme/app#3'], into: { kind: 'new', name: 'Billing', topicKind: 'project' }, reason: 'unknown id, a name' }]);
  });

  it('carries a new topic\'s kind from the split', () => {
    const result = mapTidyAnswer(
      answer({ splits: [{ topicId: 'c', prKeys: ['acme/app#3'], intoTopicId: null, newName: 'Migration safety', newKind: 'standing', reason: 'a standard' }] }),
      input,
    );
    expect(result.splits[0]?.into).toEqual({ kind: 'new', name: 'Migration safety', topicKind: 'standing' });
  });

  it('keeps renames and kind changes of known topics that stay, once each, Archive topics included', () => {
    const result = mapTidyAnswer(
      answer({
        merges: [{ fromTopicIds: ['b'], intoTopicId: 'a', name: null, reason: 'x' }],
        renames: [
          { topicId: 'c', name: ' Migration safety ', reason: 'named after one step' },
          { topicId: 'c', name: 'Again', reason: 'second rename of c' },
          { topicId: 'b', name: 'Folded', reason: 'merged away' },
          { topicId: 'a', name: 'A', reason: 'same name' },
          { topicId: 'zz', name: 'Unknown', reason: 'unknown' },
        ],
        kinds: [
          { topicId: 'c', kind: 'standing' },
          { topicId: 'a', kind: 'project' },
          { topicId: 'b', kind: 'standing' },
        ],
      }),
      input,
    );
    expect(result.renames).toEqual([{ topicId: 'c', name: 'Migration safety', reason: 'named after one step' }]);
    expect(result.kinds).toEqual([{ topicId: 'c', kind: 'standing' }]);
  });
});
