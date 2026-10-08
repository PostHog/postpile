import type { PrSet } from '@postpile/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dossierContextHash, dossierInputHash, glanceItemInputHash, glanceItemInputHashWithBotTalk, legacyGlanceItemInputHash, setGroupingTriggers } from './hashes.ts';
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

  it('ignores bot comments and PR update timestamps', () => {
    expect(glanceHash(makePr({ updatedAt: '2026-09-09T00:00:00Z', comments: [makeComment({ author: 'dependabot[bot]' })] }))).toBe(base);
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
    const legacy = (version: number) => legacyGlanceItemInputHash(glanceBatch({ items: [item], dossier: makeDossierVersion({ version }) }), item, '2026-09-02T00:00:00Z');
    expect(legacy(1)).not.toBe(base);
    expect(legacy(8)).not.toBe(legacy(1));
  });

  describe('bot talk', () => {
    const BOT = 'greptile-apps[bot]';
    const opener = makeComment({ id: 'g1', author: BOT, body: 'Possible null dereference', createdAt: '2026-09-02T10:00:00Z', threadId: 't1', kind: 'review_comment', path: 'a.ts' });
    const fixed = makeComment({ id: 'a1', author: 'alice', body: 'fixed', createdAt: '2026-09-02T11:00:00Z', threadId: 't1', kind: 'review_comment', path: 'a.ts', reviewId: 'r1' });
    const command = makeComment({ id: 'a2', author: 'alice', body: '@codex review', createdAt: '2026-09-02T11:05:00Z' });
    const carrier = { id: 'r1', author: 'alice', state: 'COMMENTED', body: '', submittedAt: '2026-09-02T11:00:00Z', commitOid: null } as const;
    const thread = { id: 't1', path: 'a.ts', isResolved: false, comments: [opener, fixed] };
    const quiet = makePr({ comments: [opener], threads: [{ ...thread, comments: [opener] }] });
    const noisy = makePr({ comments: [opener, fixed, command], threads: [thread], reviews: [carrier] });
    const hashOf = (pr: typeof quiet) => glanceHash(pr);

    it('leaves a reply to a bot, a bot command and the empty review carrying a reply out', () => {
      expect(hashOf(noisy)).toBe(hashOf(quiet));
    });

    it('still covers a real comment next to them', () => {
      const question = makeComment({ id: 'b1', author: 'bob', body: 'Why not cache this?', createdAt: '2026-09-02T12:00:00Z' });
      expect(hashOf({ ...noisy, comments: [...noisy.comments, question] })).not.toBe(hashOf(noisy));
    });

    it('matches a glance written before the update with the bot talk there was, and ignores bot talk since', () => {
      const own = { ...item, pr: noisy };
      const batch = glanceBatch({ items: [own] });
      const writtenAt = '2026-09-02T11:30:00Z';
      // The old shape counted the reply, the command and the carrier: what a glance written at 11:30 stored.
      const stored = glanceItemInputHashWithBotTalk(batch, own, writtenAt);
      expect(stored).not.toBe(glanceItemInputHash(batch, own));
      const later = makeComment({ id: 'a3', author: 'alice', body: '/trunk merge', createdAt: '2026-09-02T13:00:00Z' });
      const after = { ...own, pr: { ...noisy, comments: [...noisy.comments, later] } };
      expect(glanceItemInputHashWithBotTalk(glanceBatch({ items: [after] }), after, writtenAt)).toBe(stored);
      // A person's comment after the glance is a real change in any shape.
      const real = makeComment({ id: 'b2', author: 'bob', body: 'Blocker: wrong key.', createdAt: '2026-09-02T13:00:00Z' });
      const changed = { ...own, pr: { ...noisy, comments: [...noisy.comments, real] } };
      expect(glanceItemInputHashWithBotTalk(glanceBatch({ items: [changed] }), changed, writtenAt)).not.toBe(stored);
    });

    it('is the current hash for a PR without bot talk', () => {
      const own = { ...item, pr: quiet };
      const batch = glanceBatch({ items: [own] });
      expect(glanceItemInputHashWithBotTalk(batch, own, '2026-09-02T11:30:00Z')).toBe(glanceItemInputHash(batch, own));
    });
  });

  it('changes every shape for a PR with a declared layer below, and no other', () => {
    const note = { number: 7, state: 'draft', commits: 3, sharedCommits: 2, sharedFiles: ['ci.yml'] };
    const declared = { ...item, declaredParent: note };
    const batch = glanceBatch({ items: [declared] });
    const plain = glanceBatch({ items: [item] });
    expect(glanceItemInputHash(glanceBatch({ items: [{ ...item, declaredParent: undefined }] }), { ...item, declaredParent: undefined })).toBe(base);
    expect(glanceItemInputHash(batch, declared)).not.toBe(base);
    const writtenAt = '2026-09-02T11:30:00Z';
    expect(glanceItemInputHashWithBotTalk(batch, declared, writtenAt)).not.toBe(glanceItemInputHashWithBotTalk(plain, item, writtenAt));
    expect(legacyGlanceItemInputHash(batch, declared, writtenAt)).not.toBe(legacyGlanceItemInputHash(plain, item, writtenAt));
    expect(glanceItemInputHash(batch, { ...declared, declaredParent: { ...note, state: 'merged' } })).not.toBe(glanceItemInputHash(batch, declared));
  });

  it('changes for a PR with a merge order ("depends on"), and with its state', () => {
    const depending = { ...item, dependsOn: { number: 7, state: 'open' } };
    const batch = glanceBatch({ items: [depending] });
    expect(glanceItemInputHash(batch, depending)).not.toBe(base);
    expect(glanceItemInputHash(batch, { ...depending, dependsOn: { number: 7, state: 'merged' } })).not.toBe(glanceItemInputHash(batch, depending));
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
