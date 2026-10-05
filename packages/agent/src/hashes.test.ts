import type { PrSet } from '@postpile/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dossierContextHash, dossierInputHash, glanceItemInputHash, legacyGlanceItemInputHash, setGroupingTriggers } from './hashes.ts';
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

  it('ignores every checks change: CI is not a signal', () => {
    const failed = { name: 'backend-tests', conclusion: 'FAILURE', completedAt: '2026-09-02T09:30:00Z' };
    expect(glanceHash(makePr({ checks: { rollup: 'FAILURE', contexts: [failed] } }))).toBe(base);
    expect(glanceHash(makePr({ checks: { rollup: 'PENDING', contexts: [{ ...failed, conclusion: null, completedAt: null }] } }))).toBe(base);
    expect(glanceHash(makePr({ checks: { rollup: 'NONE', contexts: [] } }))).toBe(base);
  });

  it('ignores bot review comments but changes on an agent approval', () => {
    const botComment = { id: 'rb', author: 'reviewbot[bot]', state: 'COMMENTED', body: 'nit', submittedAt: '2026-09-01T00:00:00Z', commitOid: null } as const;
    expect(glanceHash(makePr({ reviews: [botComment] }))).toBe(base);
    expect(glanceHash(makePr({ reviews: [{ ...botComment, state: 'APPROVED' }] }))).not.toBe(base);
  });

  it('changes on a new push, a human comment, instructions or tailoring', () => {
    expect(glanceHash(makePr({ headOid: 'def' }))).not.toBe(base);
    expect(glanceHash(makePr({ comments: [makeComment()] }))).not.toBe(base);
    expect(glanceHash(item.pr, { context: { ...emptyContext, instructions: 'x' } })).not.toBe(base);
    expect(glanceHash(item.pr, { context: { ...emptyContext, tailoring: 'x' } })).not.toBe(base);
  });

  it('changes when a bot PR gets assignees, not when a person’s PR does', () => {
    const botPr = makePr({ author: 'acme-agent[bot]' });
    expect(glanceHash(makePr({ author: 'acme-agent[bot]', assignees: ['viewer'] }))).not.toBe(glanceHash(botPr));
    expect(glanceHash(makePr({ assignees: ['viewer'] }))).toBe(base);
  });

  it('does not depend on the other PRs in the batch or the attempt', () => {
    const other = { pr: makePr({ ref: { repo: 'acme/app', number: 2 } }), provenance: { kind: 'pinged', reason: 'mention' } } as const;
    expect(glanceItemInputHash(glanceBatch({ items: [other, item], attempt: 2 }), item)).toBe(base);
  });

  it('leaves the dossier version out, so a rewrite for another PR keeps the glance current', () => {
    expect(glanceHash(item.pr, { dossier: makeDossierVersion({ version: 8 }) })).toBe(base);
  });

  it('covers an edit of a human comment, not of a bot comment', () => {
    const comment = makeComment({ id: 'c1', author: 'bob', body: 'Looks good.' });
    const before = glanceHash({ ...item.pr, comments: [comment] });
    expect(glanceHash({ ...item.pr, comments: [{ ...comment, body: 'Blocker: the cache key is wrong.', lastEditedAt: '2026-09-02T12:00:00Z' }] })).not.toBe(before);
    const bot = makeComment({ id: 'c2', author: 'github-actions[bot]', body: 'Bundle +2 KB' });
    expect(glanceHash({ ...item.pr, comments: [bot] })).toBe(glanceHash({ ...item.pr, comments: [{ ...bot, lastEditedAt: '2026-09-02T12:00:00Z' }] }));
  });

  it('keeps the old shape, with the dossier version, as the legacy hash', () => {
    const legacy = (version: number) => legacyGlanceItemInputHash(glanceBatch({ items: [item], dossier: makeDossierVersion({ version }) }), item);
    expect(legacy(1)).not.toBe(base);
    expect(legacy(8)).not.toBe(legacy(1));
  });

  it('covers feedback on this PR only', () => {
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

describe('setGroupingTriggers', () => {
  const set: PrSet = {
    id: 's1',
    topicId: 't1',
    title: 'Depot',
    take: '',
    members: [{ prKey: 'acme/app#1', reason: '' }, { prKey: 'acme/app#2', reason: '' }],
    removedKeys: [],
    status: 'active',
    inputHash: 'h',
    createdAt: '',
    updatedAt: '',
  };
  const open = (number: number) => makePr({ ref: { repo: 'acme/app', number } });
  const input = { topic: makeTopic(), prs: [open(1), open(2), open(3)], existingSets: [set], risks: { 'acme/app#3': 'low - docs' }, context: emptyContext };

  it('names the open PRs to place and every member, with their risk level', () => {
    const triggers = setGroupingTriggers(input);
    expect(triggers).toContain('open:acme/app#3:low');
    expect(triggers).toContain('member:s1:acme/app#1:');
    expect(triggers).not.toContain('open:acme/app#1:');
  });

  it('gets a new trigger when a risk level changes, not when the wording does', () => {
    const reworded = setGroupingTriggers({ ...input, risks: { 'acme/app#3': 'Low. Only docs.' } });
    expect(reworded).toEqual(setGroupingTriggers(input));
    expect(setGroupingTriggers({ ...input, risks: { 'acme/app#3': 'high - migrations' } })).toContain('open:acme/app#3:high');
  });

  it('only loses triggers when a PR in no set merges', () => {
    const merged = setGroupingTriggers({ ...input, prs: [open(1), open(2), makePr({ ref: { repo: 'acme/app', number: 3 }, state: 'MERGED' })] });
    const before = new Set(setGroupingTriggers(input));
    expect(merged.every((trigger) => before.has(trigger))).toBe(true);
  });

  it('reacts to new feedback, dissolved sets and removed members', () => {
    const withFeedback = setGroupingTriggers({ ...input, context: { ...emptyContext, recentFeedback: [makeFeedback({ kind: 'not_related' })] } });
    expect(withFeedback.some((trigger) => trigger.startsWith('feedback:'))).toBe(true);
    expect(setGroupingTriggers({ ...input, existingSets: [{ ...set, status: 'dissolved' }] })).toContain('dissolved:s1');
    expect(setGroupingTriggers({ ...input, existingSets: [{ ...set, removedKeys: ['acme/app#9'] }] })).toContain('removed:s1:acme/app#9');
  });
});

describe('standing rules', () => {
  it('are part of every input hash', () => {
    const withRule = { ...emptyContext, standingRules: ['skip docs PRs'] };
    expect(glanceHash(item.pr, { context: withRule })).not.toBe(glanceHash());
    const sets = { topic: makeTopic(), prs: [makePr()], existingSets: [], risks: {}, context: emptyContext };
    expect(setGroupingTriggers({ ...sets, context: withRule })).not.toEqual(setGroupingTriggers(sets));
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
    relationSignals: { relation: null, ownerTeam: null, whyYou: 'team-platform review requested', notes: ['review requested from the user team'] },
    driverPick: null,
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
