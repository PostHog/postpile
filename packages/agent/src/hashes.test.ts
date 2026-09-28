import type { PrSet } from '@postpile/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dossierContextHash, dossierInputHash, glanceItemInputHash, setGroupingInputHash } from './hashes.ts';
import type { DossierUpdateInput, GlanceBatchInput } from './service.ts';
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

const item = { pr: makePr(), provenance: { kind: 'pinged', reason: 'review_requested' } } as const;

function glanceBatch(overrides: Partial<GlanceBatchInput> = {}): GlanceBatchInput {
  return { topic: makeTopic(), dossier: makeDossierVersion(), items: [item], viewer, context: emptyContext, attempt: 1, ...overrides };
}

/** The item hash for one PR, alone in its batch. */
function glanceHash(pr = item.pr, overrides: Partial<GlanceBatchInput> = {}): string {
  const own = { ...item, pr };
  return glanceItemInputHash(glanceBatch({ items: [own], ...overrides }), own);
}

describe('glanceItemInputHash', () => {
  const base = glanceHash();

  it('is stable for the same input', () => {
    expect(glanceHash()).toBe(base);
  });

  it('ignores bot comments, PR update timestamps and CI re-runs', () => {
    expect(glanceHash(makePr({ updatedAt: '2026-09-09T00:00:00Z', comments: [makeComment({ author: 'dependabot[bot]' })] }))).toBe(base);
    expect(glanceHash(makePr({ checks: { rollup: 'FAILURE', contexts: [] } }))).toBe(base);
  });

  it('changes on a new push, a human comment, instructions or tailoring', () => {
    expect(glanceHash(makePr({ headOid: 'def' }))).not.toBe(base);
    expect(glanceHash(makePr({ comments: [makeComment()] }))).not.toBe(base);
    expect(glanceHash(item.pr, { context: { ...emptyContext, instructions: 'x' } })).not.toBe(base);
    expect(glanceHash(item.pr, { context: { ...emptyContext, tailoring: 'x' } })).not.toBe(base);
  });

  it('does not depend on the other PRs in the batch or the attempt', () => {
    const other = { pr: makePr({ ref: { repo: 'acme/app', number: 2 } }), provenance: { kind: 'pinged', reason: 'mention' } } as const;
    expect(glanceItemInputHash(glanceBatch({ items: [other, item], attempt: 2 }), item)).toBe(base);
  });

  it('covers the dossier version and feedback on this PR only', () => {
    expect(glanceHash(item.pr, { dossier: makeDossierVersion({ version: 8 }) })).not.toBe(base);
    expect(glanceHash(item.pr, { context: { ...emptyContext, recentFeedback: [makeFeedback({ prKey: 'acme/app#9' })] } })).toBe(base);
    expect(glanceHash(item.pr, { context: { ...emptyContext, recentFeedback: [makeFeedback({ prKey: item.pr.key })] } })).not.toBe(base);
  });

  describe('model', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('changes when the glance model changes', () => {
      vi.stubEnv('POSTPILE_GLANCE_MODEL', 'claude-sonnet-4-5');
      expect(glanceHash()).not.toBe(base);
    });
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
    expect(glanceHash(item.pr, { context: withRule })).not.toBe(glanceHash());
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
    chatTurns: [],
    relationSignals: { relation: null, ownerTeam: null, whyYou: 'team-devex review requested', notes: ['review requested from the user team'] },
    areas: [{ name: 'CI', topics: 3 }],
    currentArea: null,
    viewer,
    context: emptyContext,
    ...overrides,
  };
}

describe('dossierInputHash', () => {
  const base = dossierInputHash(dossierInput());

  it('reacts to the previous version, new events, joined PRs, stale facts, feedback and the context', () => {
    expect(dossierInputHash(dossierInput({ previous: makeDossierVersion({ version: 8 }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ previous: null }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ delta: makeDelta({ events: [makeEvent({ id: 'other' })] }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ delta: makeDelta({ events: [makeEvent()], joinedPrKeys: ['acme/app#2'] }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ staleFacts: [makeFact()] }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ delta: makeDelta({ events: [makeEvent()], newFeedback: [makeFeedback()] }) }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ context: { ...emptyContext, tailoring: 'x' } }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ context: { ...emptyContext, standingRules: ['x'] } }))).not.toBe(base);
    expect(dossierInputHash(dossierInput({ context: { ...emptyContext, instructions: 'new text' } }))).not.toBe(base);
  });

  it('ignores known facts', () => {
    expect(dossierInputHash(dossierInput({ knownFacts: [makeFact()] }))).toBe(base);
  });
});

describe('dossierContextHash', () => {
  it('covers instructions, tailoring and standing rules, not feedback', () => {
    const base = dossierContextHash(emptyContext);
    expect(dossierContextHash({ ...emptyContext, instructions: 'x' })).not.toBe(base);
    expect(dossierContextHash({ ...emptyContext, tailoring: 'x' })).not.toBe(base);
    expect(dossierContextHash({ ...emptyContext, standingRules: ['x'] })).not.toBe(base);
    expect(dossierContextHash({ ...emptyContext, recentFeedback: [makeFeedback()] })).toBe(base);
  });
});
