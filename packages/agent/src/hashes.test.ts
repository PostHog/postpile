import type { PrSet } from '@code-manager/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { glanceInputHash, setGroupingInputHash, topicSummaryInputHash } from './hashes.ts';
import type { GlanceInput } from './service.ts';
import { emptyContext, makeComment, makeFeedback, makePr, makeTopic, viewer } from './test-fixtures.ts';

function glanceInput(overrides: Partial<GlanceInput> = {}): GlanceInput {
  return { pr: makePr(), viewer, provenance: { kind: 'pinged', reason: 'review_requested' }, topic: null, context: emptyContext, ...overrides };
}

describe('glanceInputHash', () => {
  const base = glanceInputHash(glanceInput());

  it('is stable for the same input', () => {
    expect(glanceInputHash(glanceInput())).toBe(base);
  });

  it('ignores bot comments and PR update timestamps', () => {
    const pr = makePr({ updatedAt: '2026-09-09T00:00:00Z', comments: [makeComment({ author: 'dependabot[bot]' })] });
    expect(glanceInputHash(glanceInput({ pr }))).toBe(base);
  });

  it('ignores CI re-runs', () => {
    const pr = makePr({ checks: { rollup: 'FAILURE', contexts: [] } });
    expect(glanceInputHash(glanceInput({ pr }))).toBe(base);
  });

  it('changes on a new push, a human comment, instructions or tailoring', () => {
    expect(glanceInputHash(glanceInput({ pr: makePr({ headOid: 'def' }) }))).not.toBe(base);
    expect(glanceInputHash(glanceInput({ pr: makePr({ comments: [makeComment()] }) }))).not.toBe(base);
    expect(glanceInputHash(glanceInput({ context: { ...emptyContext, instructions: 'x' } }))).not.toBe(base);
    expect(glanceInputHash(glanceInput({ context: { ...emptyContext, tailoring: 'x' } }))).not.toBe(base);
  });

  it('only reacts to feedback about this PR', () => {
    const other = { ...emptyContext, recentFeedback: [makeFeedback({ prKey: 'acme/app#9' })] };
    const own = { ...emptyContext, recentFeedback: [makeFeedback({ prKey: 'acme/app#1' })] };
    expect(glanceInputHash(glanceInput({ context: other }))).toBe(base);
    expect(glanceInputHash(glanceInput({ context: own }))).not.toBe(base);
  });

  describe('model', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('changes when the glance model changes', () => {
      vi.stubEnv('CODE_MANAGER_GLANCE_MODEL', 'claude-sonnet-4-5');
      expect(glanceInputHash(glanceInput())).not.toBe(base);
    });
  });
});

describe('topicSummaryInputHash', () => {
  it('ignores PR order but reacts to a state change', () => {
    const a = makePr();
    const b = makePr({ ref: { repo: 'acme/app', number: 2 } });
    const input = { topic: makeTopic(), prs: [a, b], context: emptyContext };
    const hash = topicSummaryInputHash(input);
    expect(topicSummaryInputHash({ ...input, prs: [b, a] })).toBe(hash);
    expect(topicSummaryInputHash({ ...input, prs: [makePr({ state: 'MERGED' }), b] })).not.toBe(hash);
  });

  it('reacts to new feedback, which is in the prompt', () => {
    const input = { topic: makeTopic(), prs: [makePr()], context: emptyContext };
    const withFeedback = { ...input, context: { ...emptyContext, recentFeedback: [makeFeedback()] } };
    expect(topicSummaryInputHash(withFeedback)).not.toBe(topicSummaryInputHash(input));
  });
});

describe('setGroupingInputHash', () => {
  it('reacts to new feedback in the topic', () => {
    const input = { topic: makeTopic(), prs: [makePr()], existingSets: [], context: emptyContext };
    const withFeedback = { ...input, context: { ...emptyContext, recentFeedback: [makeFeedback({ kind: 'not_related' })] } };
    expect(setGroupingInputHash(withFeedback)).not.toBe(setGroupingInputHash(input));
  });

  it('ignores active sets but reacts to dissolved ones', () => {
    const input = { topic: makeTopic(), prs: [makePr()], existingSets: [] as PrSet[], context: emptyContext };
    const set: PrSet = {
      id: 's1',
      topicId: 't1',
      title: 'Depot',
      take: '',
      members: [{ prKey: 'o/r#1', reason: '' }, { prKey: 'o/r#2', reason: '' }],
      removedKeys: [],
      status: 'active',
      inputHash: 'h',
      createdAt: '',
      updatedAt: '',
    };
    const hash = setGroupingInputHash(input);
    expect(setGroupingInputHash({ ...input, existingSets: [set] })).toBe(hash);
    expect(setGroupingInputHash({ ...input, existingSets: [{ ...set, status: 'dissolved' }] })).not.toBe(hash);
  });
});
