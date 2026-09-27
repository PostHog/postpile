import type { PrSet } from '@code-manager/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dossierInputHash, glanceInputHash, glanceItemInputHash, setGroupingInputHash, topicSummaryInputHash } from './hashes.ts';
import type { DossierUpdateInput, GlanceBatchInput, GlanceInput } from './service.ts';
import {
  emptyContext,
  makeComment,
  makeDelta,
  makeDossierVersion,
  makeEvent,
  makeFact,
  makeFeedback,
  makePr,
  makeTopic,
  viewer,
} from './test-fixtures.ts';

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
    const input = { topic: makeTopic(), prs: [a, b], otherTopics: [], context: emptyContext };
    const hash = topicSummaryInputHash(input);
    expect(topicSummaryInputHash({ ...input, prs: [b, a] })).toBe(hash);
    expect(topicSummaryInputHash({ ...input, prs: [makePr({ state: 'MERGED' }), b] })).not.toBe(hash);
  });

  it('reacts to new feedback, which is in the prompt', () => {
    const input = { topic: makeTopic(), prs: [makePr()], otherTopics: [], context: emptyContext };
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

describe('standing rules', () => {
  it('are part of every input hash', () => {
    const withRule = { ...emptyContext, standingRules: ['skip docs PRs'] };
    expect(glanceInputHash(glanceInput({ context: withRule }))).not.toBe(glanceInputHash(glanceInput()));
    const summary = { topic: makeTopic(), prs: [makePr()], otherTopics: [], context: emptyContext };
    expect(topicSummaryInputHash({ ...summary, context: withRule })).not.toBe(topicSummaryInputHash(summary));
    const sets = { topic: makeTopic(), prs: [makePr()], existingSets: [], context: emptyContext };
    expect(setGroupingInputHash({ ...sets, context: withRule })).not.toBe(setGroupingInputHash(sets));
  });
});

function dossierInput(overrides: Partial<DossierUpdateInput> = {}): DossierUpdateInput {
  return {
    topic: makeTopic(),
    previous: makeDossierVersion(),
    delta: makeDelta({ events: [makeEvent()] }),
    prs: [makePr()],
    knownFacts: [],
    staleFacts: [],
    viewer,
    context: emptyContext,
    ...overrides,
  };
}

describe('dossierInputHash', () => {
  const base = dossierInputHash(dossierInput());

  it('reacts to the previous version, new events, joined PRs, stale facts, feedback, tailoring and rules', () => {
    expect(dossierInputHash(dossierInput({ previous: makeDossierVersion({ version: 8 }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ previous: null }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ delta: makeDelta({ events: [makeEvent({ id: 'other' })] }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ delta: makeDelta({ events: [makeEvent()], joinedPrKeys: ['acme/app#2'] }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ staleFacts: [makeFact()] }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ delta: makeDelta({ events: [makeEvent()], newFeedback: [makeFeedback()] }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ context: { ...emptyContext, tailoring: 'x' } }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ context: { ...emptyContext, standingRules: ['x'] } }))).not.toBe(base);
  });

  it('ignores the instructions file and known facts', () => {
    expect(dossierInputHash(dossierInput({ context: { ...emptyContext, instructions: 'new text' } }))).toBe(base);
    expect(dossierInputHash(dossierInput({ knownFacts: [makeFact()] }))).toBe(base);
  });
});

describe('glanceItemInputHash', () => {
  const pr1 = makePr();
  const pr2 = makePr({ ref: { repo: 'acme/app', number: 2 } });
  const item = { pr: pr1, provenance: { kind: 'pinged', reason: 'review_requested' } } as const;
  function batch(overrides: Partial<GlanceBatchInput> = {}): GlanceBatchInput {
    return { topic: makeTopic(), dossier: makeDossierVersion(), items: [item], viewer, context: emptyContext, attempt: 1, ...overrides };
  }
  const base = glanceItemInputHash(batch(), item);

  it('does not depend on the other PRs in the batch or the attempt', () => {
    const other = { pr: pr2, provenance: { kind: 'pinged', reason: 'mention' } } as const;
    expect(glanceItemInputHash(batch({ items: [other, item], attempt: 2 }), item)).toBe(base);
  });

  it('covers the dossier version and feedback on this PR only', () => {
    expect(glanceItemInputHash(batch({ dossier: makeDossierVersion({ version: 8 }) }), item)).not.toBe(base);
    expect(glanceItemInputHash(batch({ context: { ...emptyContext, recentFeedback: [makeFeedback({ prKey: 'acme/app#9' })] } }), item)).toBe(base);
    expect(glanceItemInputHash(batch({ context: { ...emptyContext, recentFeedback: [makeFeedback({ prKey: pr1.key })] } }), item)).not.toBe(base);
  });

  it('differs from the v1 glance hash', () => {
    expect(base).not.toBe(glanceInputHash(glanceInput()));
  });
});
