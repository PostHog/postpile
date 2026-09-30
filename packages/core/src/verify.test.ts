import { describe, expect, it } from 'vitest';
import { emptyDossier } from './dossier.ts';
import { at, makeComment, makeCommit, makeFact, makeFactRef, makePr, makeReview, makeThread, makeTimelineItem } from './fixtures.ts';
import type { Dossier } from './memory.ts';
import type { Pr } from './types.ts';
import { verifyDossier, verifyFact, withoutStaleClaims, type VerifyWorld } from './verify.ts';

function world(prs: Pr[], memberKeys: string[] = []): VerifyWorld {
  return { prs: new Map(prs.map((pr) => [pr.key, pr])), memberKeys: new Set(memberKeys), now: at(1000) };
}

const pr1 = makePr({ number: 1, author: 'alice', headOid: 'h1', commits: [makeCommit({ oid: 'h1', author: 'alice' })] });

describe('verifyFact', () => {
  it('is ok when nothing moved', () => {
    expect(verifyFact(makeFact(), world([pr1]))).toEqual({ kind: 'ok' });
  });

  it('is stale when a referenced PR is not in the store', () => {
    const fact = makeFact({ refs: [makeFactRef({ prKey: 'acme/app#99' })] });
    expect(verifyFact(fact, world([pr1]))).toEqual({ kind: 'stale', reason: 'pr_missing' });
  });

  it('closes a lifecycle fact when its PR merged', () => {
    const merged = { ...pr1, state: 'MERGED' as const, mergedAt: at(50) };
    expect(verifyFact(makeFact(), world([merged]))).toEqual({ kind: 'invalidate', reason: 'pr_merged', at: at(50) });
  });

  it('closes a lifecycle fact at the last close time when its PR closed', () => {
    const closed = {
      ...pr1,
      state: 'CLOSED' as const,
      timeline: [makeTimelineItem({ id: 'x1', kind: 'closed', at: at(40) }), makeTimelineItem({ id: 'x2', kind: 'closed', at: at(60) })],
    };
    expect(verifyFact(makeFact(), world([closed]))).toEqual({ kind: 'invalidate', reason: 'pr_closed', at: at(60) });
  });

  it('marks a status fact about a PR that closed later as stale', () => {
    const closed = { ...pr1, state: 'CLOSED' as const, updatedAt: at(70) };
    const fact = makeFact({
      subject: { kind: 'pr', key: pr1.key },
      predicate: 'status',
      object: null,
      text: 'waiting on review from bob',
      validFrom: at(10),
    });
    expect(verifyFact(fact, world([closed]))).toEqual({ kind: 'stale', reason: 'pr_closed' });
  });

  it('keeps non-lifecycle facts about a merged PR', () => {
    const merged = { ...pr1, state: 'MERGED' as const, mergedAt: at(50) };
    const fact = makeFact({ subject: { kind: 'pr', key: pr1.key }, predicate: 'part_of', object: { kind: 'initiative', key: 'topic-1' } });
    expect(verifyFact(fact, world([merged]))).toEqual({ kind: 'ok' });
  });

  it('is stale when a ref pinned a head that moved, for facts about the code', () => {
    const refs = [makeFactRef({ headOid: 'h0' })];
    const decided = makeFact({ subject: { kind: 'pr', key: pr1.key }, predicate: 'decided', object: null, text: 'keep the old cache', refs });
    expect(verifyFact(decided, world([pr1]))).toEqual({ kind: 'stale', reason: 'head_moved' });
    expect(verifyFact(makeFact({ refs }), world([pr1]))).toEqual({ kind: 'ok' });
  });

  it('is stale when a reviewer is no longer on the PR', () => {
    const fact = makeFact({ subject: { kind: 'person', key: 'bob' }, predicate: 'reviews', text: 'bob reviews #1' });
    expect(verifyFact(fact, world([pr1]))).toEqual({ kind: 'stale', reason: 'person_not_involved' });
    const requested = { ...pr1, reviewerUsers: ['Bob'] };
    expect(verifyFact(fact, world([requested]))).toEqual({ kind: 'ok' });
    const reviewed = { ...pr1, reviews: [makeReview({ author: 'bob' })] };
    expect(verifyFact(fact, world([reviewed]))).toEqual({ kind: 'ok' });
  });

  it('counts committers as working on the PR', () => {
    const fact = makeFact({ subject: { kind: 'person', key: 'carol' } });
    expect(verifyFact(fact, world([pr1]))).toEqual({ kind: 'stale', reason: 'person_not_involved' });
    const withCommit = { ...pr1, commits: [...pr1.commits, makeCommit({ oid: 'h2', author: 'carol' })] };
    expect(verifyFact(fact, world([withCommit]))).toEqual({ kind: 'ok' });
  });

  it('is stale when a cited comment, review or commit is gone', () => {
    const cites = (kind: 'comment' | 'review' | 'commit', sourceId: string) =>
      makeFact({ predicate: 'note', object: null, refs: [makeFactRef({ kind, sourceId })] });
    const withSources = {
      ...pr1,
      comments: [makeComment({ id: 'c1' })],
      threads: [makeThread('t1', [makeComment({ id: 'rc1' })])],
      reviews: [makeReview({ id: 'r1' })],
    };
    expect(verifyFact(cites('comment', 'c1'), world([withSources]))).toEqual({ kind: 'ok' });
    expect(verifyFact(cites('comment', 'rc1'), world([withSources]))).toEqual({ kind: 'ok' });
    expect(verifyFact(cites('review', 'r1'), world([withSources]))).toEqual({ kind: 'ok' });
    expect(verifyFact(cites('commit', 'h1'), world([withSources]))).toEqual({ kind: 'ok' });
    expect(verifyFact(cites('comment', 'gone'), world([withSources]))).toEqual({ kind: 'stale', reason: 'source_deleted' });
    expect(verifyFact(cites('review', 'gone'), world([withSources]))).toEqual({ kind: 'stale', reason: 'source_deleted' });
    expect(verifyFact(cites('commit', 'gone'), world([withSources]))).toEqual({ kind: 'stale', reason: 'source_deleted' });
  });
});

describe('verifyDossier', () => {
  const resolved = { ...makeThread('t1', [makeComment({ id: 'rc1' })]), isResolved: true };
  const pr = { ...pr1, comments: [makeComment({ id: 'c1' })], threads: [resolved] };

  function question(sourceId: string, prKey = pr.key) {
    return { text: `about ${sourceId}`, askedBy: 'carol', refs: [makeFactRef({ kind: 'comment', prKey, sourceId })] };
  }

  it('flags questions in resolved threads, deleted comments and missing PRs', () => {
    const dossier: Dossier = {
      ...emptyDossier(),
      openQuestions: [question('c1'), question('rc1'), question('gone'), question('c1', 'acme/app#99'), { text: 'no refs', askedBy: null, refs: [] }],
    };
    expect(verifyDossier(dossier, world([pr], [pr.key]))).toEqual([
      { path: 'openQuestions[1]', reason: 'thread_resolved' },
      { path: 'openQuestions[2]', reason: 'source_deleted' },
      { path: 'openQuestions[3]', reason: 'pr_missing' },
    ]);
  });

  it('flags and drops a bot driver once its PR has other owners', () => {
    const bot = 'acme-agent[bot]';
    const assigned = makePr({ number: 5, author: bot, assignees: ['lyra'] });
    const unassigned = makePr({ number: 6, author: bot, assignees: [] });
    const dossier: Dossier = {
      ...emptyDossier(),
      people: [
        { login: bot, role: 'driver', note: 'opened the PR' },
        { login: 'lyra', role: 'reviewer', note: '' },
      ],
    };
    expect(verifyDossier(dossier, world([assigned], [assigned.key]))).toEqual([{ path: 'people[0]', reason: 'person_not_involved' }]);
    expect(withoutStaleClaims(dossier, world([assigned], [assigned.key])).people).toEqual([dossier.people[1]]);
    // No assignees yet: the bot still drives its own PR.
    expect(verifyDossier(dossier, world([unassigned], [unassigned.key]))).toEqual([]);
  });

  it('flags timeline entries for PRs that left the topic', () => {
    const dossier: Dossier = {
      ...emptyDossier(),
      timeline: [
        { prKey: pr.key, role: 'base image' },
        { prKey: 'acme/app#2', role: 'moved away' },
      ],
    };
    expect(verifyDossier(dossier, world([pr], [pr.key]))).toEqual([{ path: 'timeline[1]', reason: 'left_topic' }]);
  });

  it('drops exactly the flagged claims', () => {
    const dossier: Dossier = {
      ...emptyDossier(),
      openQuestions: [question('c1'), question('rc1'), { text: 'no refs', askedBy: null, refs: [] }],
      timeline: [
        { prKey: pr.key, role: 'base image' },
        { prKey: 'acme/app#2', role: 'moved away' },
      ],
    };
    const clean = withoutStaleClaims(dossier, world([pr], [pr.key]));
    expect(clean.openQuestions.map((q) => q.text)).toEqual(['about c1', 'no refs']);
    expect(clean.timeline.map((entry) => entry.prKey)).toEqual([pr.key]);
    expect(verifyDossier(clean, world([pr], [pr.key]))).toEqual([]);
  });
});
