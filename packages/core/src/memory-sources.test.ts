import { describe, expect, it } from 'vitest';
import { clampDossier, DOSSIER_LIMITS, emptyDossier } from './dossier.ts';
import { findDossierLine } from './dossier-lines.ts';
import { at, makeComment, makeCommit, makeEvent, makeFact, makeFactRef, makePr, makeReview, makeThread } from './fixtures.ts';
import type { Dossier, UserRef } from './memory.ts';
import { describeFactRef, describeLineSources, describeUserRef, factCheck, lineCheck } from './memory-sources.ts';
import { dossierLineIssue, type VerifyWorld } from './verify.ts';

const pr = makePr({
  number: 1,
  author: 'alice',
  headOid: 'h2',
  comments: [makeComment({ id: 'c1', author: 'bob', body: 'Does the warm-up need a flag?' })],
  threads: [{ ...makeThread('t1', [makeComment({ id: 'c9', author: 'lyra' })]), isResolved: true }],
  reviews: [makeReview({ id: 'r1', author: 'lyra', state: 'CHANGES_REQUESTED', body: 'Pin the image.' })],
  commits: [makeCommit({ oid: 'h2abcdef', headline: 'move e2e', author: 'alice' })],
});

const chat: UserRef = { kind: 'chat', id: '12', at: at(30), quote: 'Always flag cache keys.' };

function world(memberKeys: string[] = [pr.key]): VerifyWorld {
  return { prs: new Map([[pr.key, pr]]), memberKeys: new Set(memberKeys), now: at(100) };
}

function dossier(overrides: Partial<Dossier> = {}): Dossier {
  return {
    ...emptyDossier(),
    goal: 'Run CI on Depot',
    status: 'active',
    statusNote: 'no blockers',
    statusSources: { refs: [makeFactRef({ prKey: pr.key, headOid: 'h1' })], userRefs: [] },
    openQuestions: [{ text: 'Flag?', askedBy: 'bob', refs: [makeFactRef({ kind: 'comment', prKey: pr.key, sourceId: 'c9' })] }],
    timeline: [{ prKey: pr.key, role: 'moves e2e', refs: [makeFactRef({ prKey: pr.key })], userRefs: [chat] }],
    userCares: [{ text: 'Cache keys', source: 'tailoring', userRefs: [chat] }],
    ...overrides,
  };
}

describe('findDossierLine', () => {
  it('finds every kind of line and its sources', () => {
    const d = dossier();
    expect(findDossierLine(d, 'goal')).toEqual({ path: 'goal', text: 'Run CI on Depot', sources: { refs: [], userRefs: [] } });
    expect(findDossierLine(d, 'status')?.text).toBe('active: no blockers');
    expect(findDossierLine(d, 'timeline[0]')?.sources.userRefs).toEqual([chat]);
    expect(findDossierLine(d, 'userCares[0]')?.text).toBe('Cache keys');
    expect(findDossierLine(d, 'openQuestions[5]')).toBeNull();
    expect(findDossierLine(d, 'people[0]')).toBeNull();
  });
});

describe('dossierLineIssue', () => {
  it('reports what verifyDossier finds for the line', () => {
    expect(dossierLineIssue(dossier(), 'openQuestions[0]', world())).toBe('thread_resolved');
    expect(dossierLineIssue(dossier(), 'timeline[0]', world([]))).toBe('left_topic');
  });

  it('flags the status line when the head moved since it was written', () => {
    expect(dossierLineIssue(dossier(), 'status', world())).toBe('head_moved');
    const current = dossier({ statusSources: { refs: [makeFactRef({ prKey: pr.key, headOid: 'h2' })], userRefs: [] } });
    expect(dossierLineIssue(current, 'status', world())).toBeNull();
  });

  it('flags deleted sources and PRs that are not synced', () => {
    const deleted = dossier({ userCares: [{ text: 'x', source: 'observed', refs: [makeFactRef({ kind: 'comment', prKey: pr.key, sourceId: 'gone' })] }] });
    expect(dossierLineIssue(deleted, 'userCares[0]', world())).toBe('source_deleted');
    const missing = dossier({ goalSources: { refs: [makeFactRef({ prKey: 'acme/app#77' })], userRefs: [] } });
    expect(dossierLineIssue(missing, 'goal', world())).toBe('pr_missing');
  });
});

describe('describeFactRef', () => {
  it('reads who said what from the PR snapshot', () => {
    expect(describeFactRef(makeFactRef({ kind: 'comment', prKey: pr.key, sourceId: 'c1' }), pr, [])).toMatchObject({
      who: 'bob',
      title: 'commented on #1',
      excerpt: 'Does the warm-up need a flag?',
      missing: false,
    });
    expect(describeFactRef(makeFactRef({ kind: 'review', prKey: pr.key, sourceId: 'r1' }), pr, [])).toMatchObject({
      who: 'lyra',
      title: 'requested changes on #1',
      excerpt: 'Pin the image.',
    });
    expect(describeFactRef(makeFactRef({ kind: 'commit', prKey: pr.key, sourceId: 'h2abcdef' }), pr, [])).toMatchObject({
      who: 'alice',
      title: 'pushed h2abcde to #1',
    });
    expect(describeFactRef(makeFactRef({ prKey: pr.key }), pr, [])).toMatchObject({ who: 'alice', title: 'opened #1', excerpt: pr.title });
  });

  it('finds events in the stored events and marks missing sources', () => {
    const event = makeEvent({ id: 'e1', prKey: pr.key, actor: 'carol', kind: 'mention', summary: 'carol mentioned you' });
    expect(describeFactRef(makeFactRef({ kind: 'event', prKey: pr.key, sourceId: 'e1' }), pr, [event])).toMatchObject({
      who: 'carol',
      title: 'mention on #1',
    });
    expect(describeFactRef(makeFactRef({ kind: 'comment', prKey: pr.key, sourceId: 'gone' }), pr, []).missing).toBe(true);
    expect(describeFactRef(makeFactRef({ prKey: 'acme/app#77' }), undefined, [])).toMatchObject({ title: '#77, not synced', missing: true });
  });
});

describe('describeLineSources', () => {
  it('merges GitHub and user sources, oldest first', () => {
    const sources = { refs: [makeFactRef({ prKey: pr.key, kind: 'comment', sourceId: 'c1' })], userRefs: [chat] };
    const described = describeLineSources(sources, new Map([[pr.key, pr]]), new Map());
    expect(described.map((source) => source.title)).toEqual(['commented on #1', 'You said in chat']);
    expect(describeUserRef({ kind: 'instructions', id: '3', at: at(1), quote: 'Added cache keys' }).title).toBe('Your instructions, version 3');
  });
});

describe('checks', () => {
  it('says what backs a dossier line', () => {
    expect(lineCheck({ refs: [makeFactRef()], userRefs: [] }, null).state).toBe('ok');
    expect(lineCheck({ refs: [], userRefs: [chat] }, null).state).toBe('user_only');
    expect(lineCheck({ refs: [], userRefs: [] }, null).state).toBe('unsourced');
    expect(lineCheck({ refs: [makeFactRef()], userRefs: [] }, 'head_moved')).toEqual({ state: 'stale', reason: 'head_moved', note: null });
  });

  it('says whether a fact still holds', () => {
    expect(factCheck(makeFact(), { kind: 'ok' }).state).toBe('ok');
    expect(factCheck(makeFact(), { kind: 'stale', reason: 'head_moved' }).reason).toBe('head_moved');
    const closed = makeFact({ invalidAt: at(5), invalidReason: 'the user said it is wrong' });
    expect(factCheck(closed, { kind: 'ok' })).toEqual({ state: 'closed', reason: null, note: 'the user said it is wrong' });
  });
});

describe('clampDossier line sources', () => {
  it('keeps the oldest refs per line and clips quotes', () => {
    const refs = Array.from({ length: 10 }, (_, i) => makeFactRef({ sourceId: `s${i}`, kind: 'comment' }));
    const userRefs = Array.from({ length: 5 }, (_, i): UserRef => ({ kind: 'chat', id: `${i}`, at: at(i), quote: 'x'.repeat(400) }));
    const clamped = clampDossier(dossier({ timeline: [{ prKey: pr.key, role: 'r', refs, userRefs }] }));
    expect(clamped.timeline[0]?.refs).toHaveLength(DOSSIER_LIMITS.lineRefs);
    expect(clamped.timeline[0]?.refs?.[0]?.sourceId).toBe('s0');
    expect(clamped.timeline[0]?.userRefs).toHaveLength(DOSSIER_LIMITS.lineUserRefs);
    expect(clamped.timeline[0]?.userRefs?.[0]?.quote.length).toBe(DOSSIER_LIMITS.quote);
  });
});
