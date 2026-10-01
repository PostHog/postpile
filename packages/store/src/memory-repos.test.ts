import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDossier, type Topic } from '@postpile/core';
import { at, makeDossierVersion, makeEvent, makeFact, makeFactRef } from '@postpile/core/fixtures';
import { Store } from './index.ts';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

afterEach(() => {
  store.close();
});

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    name: 'Move CI to Depot',
    summary: '',
    summaryInputHash: null,
    kind: 'project',
    retiredAt: null,
    area: null,
    tailoring: '',
    driver: 'alice',
    userRole: 'reviewer',
    status: 'active',
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

const pr1 = 'acme/app#1';
const pr2 = 'acme/app#2';

function event(prKey: string, sourceId: string, minutes: number) {
  return makeEvent({ id: `${prKey}:comment:${sourceId}`, prKey, sourceId, at: at(minutes) });
}

describe('EventLogRepo', () => {
  it('logs first sightings once, in the given order, and lists them after a cursor', () => {
    store.events.upsertDerived(pr1, [event(pr1, 'a', 50), event(pr1, 'b', 10)]);
    store.events.upsertDerived(pr2, [event(pr2, 'c', 20)]);
    expect(store.eventLog.maxSeq()).toBe(0);

    store.eventLog.append([{ id: `${pr1}:comment:a`, prKey: pr1 }, { id: `${pr1}:comment:b`, prKey: pr1 }], at(60));
    store.eventLog.append([{ id: `${pr2}:comment:c`, prKey: pr2 }, { id: `${pr1}:comment:a`, prKey: pr1 }], at(61));

    expect(store.eventLog.maxSeq()).toBe(3);
    const all = store.eventLog.listSince([pr1, pr2], 0);
    expect(all.map((entry) => [entry.seq, entry.event.sourceId])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
    expect(store.eventLog.listSince([pr1], 1).map((entry) => entry.event.sourceId)).toEqual(['b']);
    expect(store.eventLog.countSince([pr1, pr2], 1)).toBe(2);
    expect(store.eventLog.listSince([], 0)).toEqual([]);
    expect(store.eventLog.countSince([], 0)).toBe(0);
  });

  it('skips log rows whose event is gone and never reuses a seq', () => {
    store.events.upsertDerived(pr1, [event(pr1, 'a', 1), event(pr1, 'b', 2)]);
    store.eventLog.append([{ id: `${pr1}:comment:a`, prKey: pr1 }, { id: `${pr1}:comment:b`, prKey: pr1 }], at(3));
    store.events.upsertDerived(pr1, [event(pr1, 'b', 2)]);
    expect(store.eventLog.listSince([pr1], 0).map((entry) => entry.seq)).toEqual([2]);
    expect(store.eventLog.countSince([pr1], 0)).toBe(1);

    store.events.upsertDerived(pr1, [event(pr1, 'b', 2), event(pr1, 'c', 3)]);
    store.eventLog.append([{ id: `${pr1}:comment:c`, prKey: pr1 }], at(4));
    expect(store.eventLog.listSince([pr1], 2).map((entry) => entry.seq)).toEqual([3]);
  });
});

describe('CursorRepo', () => {
  it('upserts and only moves forward', () => {
    expect(store.cursors.get('digest', 'topic-1')).toBeNull();
    store.cursors.advance({ kind: 'digest', scope: 'topic-1', seq: 5, dossierVersion: 1, updatedAt: at(1) });
    store.cursors.advance({ kind: 'digest', scope: 'topic-1', seq: 3, dossierVersion: 9, updatedAt: at(2) });
    expect(store.cursors.get('digest', 'topic-1')).toEqual({
      kind: 'digest',
      scope: 'topic-1',
      seq: 5,
      dossierVersion: 1,
      updatedAt: at(1),
    });
    store.cursors.advance({ kind: 'digest', scope: 'topic-1', seq: 5, dossierVersion: 2, updatedAt: at(3) });
    expect(store.cursors.get('digest', 'topic-1')).toMatchObject({ seq: 5, dossierVersion: 2, updatedAt: at(3) });
  });

  it('lists cursors of one kind by scope', () => {
    store.cursors.advance({ kind: 'seen', scope: 'topic-1', seq: 1, dossierVersion: null, updatedAt: at(1) });
    store.cursors.advance({ kind: 'seen', scope: 'topic-2', seq: 2, dossierVersion: null, updatedAt: at(1) });
    store.cursors.advance({ kind: 'digest', scope: 'topic-1', seq: 7, dossierVersion: null, updatedAt: at(1) });
    const seen = store.cursors.listByKind('seen');
    expect([...seen.keys()]).toEqual(['topic-1', 'topic-2']);
    expect(seen.get('topic-2')?.seq).toBe(2);
  });
});

describe('DossierRepo', () => {
  beforeEach(() => {
    store.topics.create(makeTopic());
    store.topics.create(makeTopic({ id: 'topic-2', name: 'Other' }));
  });

  it('keeps every version and returns the newest', () => {
    expect(store.dossiers.latest('topic-1')).toBeNull();
    const first = makeDossierVersion({ dossier: { ...emptyDossier(), goal: 'Run CI on Depot' } });
    const second = makeDossierVersion({
      version: 2,
      dossier: { ...emptyDossier(), goal: 'Run CI on Depot', status: 'blocked' },
      flags: [{ kind: 'needs_user', text: 'keep GitHub runners for releases?', prKey: null }],
      throughSeq: 12,
      createdAt: at(10),
    });
    store.dossiers.add(first);
    store.dossiers.add(second);
    store.dossiers.add(makeDossierVersion({ topicId: 'topic-2' }));

    expect(store.dossiers.latest('topic-1')).toEqual(second);
    expect(store.dossiers.get('topic-1', 1)).toEqual(first);
    expect(store.dossiers.listVersions('topic-1', 10).map((v) => v.version)).toEqual([2, 1]);
    expect(store.dossiers.countVersions('topic-1')).toBe(2);
    const latest = store.dossiers.latestMany(['topic-1', 'topic-2', 'topic-3']);
    expect([...latest.keys()].sort()).toEqual(['topic-1', 'topic-2']);
    expect(latest.get('topic-1')?.version).toBe(2);
    expect(store.dossiers.latestMany([]).size).toBe(0);
  });

  it('refuses a version that is not latest + 1', () => {
    expect(() => store.dossiers.add(makeDossierVersion({ version: 2 }))).toThrow(/expected version 1/);
    store.dossiers.add(makeDossierVersion());
    expect(() => store.dossiers.add(makeDossierVersion())).toThrow(/expected version 2/);
  });

  it('prunes old versions and keeps counting up after', () => {
    for (let version = 1; version <= 5; version += 1) {
      store.dossiers.add(makeDossierVersion({ version }));
    }
    expect(store.dossiers.prune('topic-1', 2)).toBe(3);
    expect(store.dossiers.listVersions('topic-1', 10).map((v) => v.version)).toEqual([5, 4]);
    store.dossiers.add(makeDossierVersion({ version: 6 }));
    expect(store.dossiers.latest('topic-1')?.version).toBe(6);
  });
});

describe('FactRepo', () => {
  const alice = { kind: 'person' as const, key: 'alice' };
  const initiative = { kind: 'initiative' as const, key: 'topic-1' };

  it('reopens a closed fact and restores its check state (undo)', () => {
    const fact = makeFact({ staleAt: at(5), staleReason: 'head_moved', verifiedAt: null });
    store.facts.add(fact);
    store.facts.close('f1', { invalidAt: at(10), reason: 'wrong', supersededBy: 'f2', expiredAt: at(10) });
    store.facts.reopen('f1');
    store.facts.markVerified(['f1'], at(11));
    store.facts.restoreCheck(fact);
    expect(store.facts.get('f1')).toEqual(fact);
  });

  it('round-trips a fact with its refs', () => {
    const fact = makeFact({
      refs: [
        makeFactRef(),
        makeFactRef({ kind: 'comment', sourceId: 'c1', url: 'https://github.com/x', at: at(12), headOid: 'h1' }),
      ],
    });
    store.facts.add(fact);
    expect(store.facts.get('f1')).toEqual(fact);
    expect(store.facts.get('nope')).toBeNull();
    expect([...store.facts.getMany(['f1', 'nope']).keys()]).toEqual(['f1']);
    expect(store.facts.getMany([]).size).toBe(0);
  });

  it('lists facts for far more entities than SQLite allows in one OR chain', () => {
    store.facts.add(makeFact({ id: 'works' }));
    const entities = Array.from({ length: 1500 }, (_, i) => ({ kind: 'person' as const, key: `user-${i}` }));
    entities.push(alice);
    expect(store.facts.listActiveForEntities(entities).map((f) => f.id)).toEqual(['works']);
  });

  it('finds active facts by entity, topic and touched PR', () => {
    store.facts.add(makeFact({ id: 'works' }));
    store.facts.add(makeFact({ id: 'drives', predicate: 'drives', object: initiative, text: 'alice drives it', recordedAt: at(12), refs: [makeFactRef({ prKey: pr2 })] }));
    store.facts.add(makeFact({ id: 'other', subject: { kind: 'person', key: 'bob' }, object: null, predicate: 'note', topicId: 'topic-2', refs: [makeFactRef({ prKey: 'x/y#3' })] }));
    store.facts.add(makeFact({ id: 'closed', invalidAt: at(20), expiredAt: at(20) }));

    expect(store.facts.listActiveForEntities([alice]).map((f) => f.id)).toEqual(['works', 'drives']);
    expect(store.facts.listActiveForEntities([initiative]).map((f) => f.id)).toEqual(['drives']);
    expect(store.facts.listActiveForEntities([])).toEqual([]);
    expect(store.facts.listActiveForTopic('topic-1').map((f) => f.id)).toEqual(['works', 'drives']);
    expect(store.facts.listActiveTouchingPrs([pr1]).map((f) => f.id)).toEqual(['works']);
    expect(store.facts.listActiveTouchingPrs([pr2]).map((f) => f.id)).toEqual(['drives']);
    expect(store.facts.listActiveTouchingPrs([])).toEqual([]);
  });

  it('merges refs on a noop without duplicates and marks it verified', () => {
    store.facts.add(makeFact());
    store.facts.addRefs('f1', [makeFactRef(), makeFactRef({ kind: 'comment', sourceId: 'c2', at: at(30) })], at(31));
    const fact = store.facts.get('f1');
    expect(fact?.refs.map((ref) => ref.sourceId)).toEqual([null, 'c2']);
    expect(fact?.verifiedAt).toBe(at(31));
  });

  it('keeps the oldest ref and the newest ten when refs pile up', () => {
    store.facts.add(makeFact());
    const refs = Array.from({ length: 15 }, (_, i) => makeFactRef({ kind: 'comment', sourceId: `c${i}`, at: at(20 + i) }));
    store.facts.addRefs('f1', refs, at(40));
    const kept = store.facts.get('f1')?.refs.map((ref) => ref.sourceId) ?? [];
    expect(kept).toHaveLength(11);
    expect(kept[0]).toBeNull();
    expect(kept.at(-1)).toBe('c14');
    expect(kept).not.toContain('c4');
  });

  it('closes a fact once and never deletes it', () => {
    store.facts.add(makeFact());
    store.facts.close('f1', { invalidAt: at(40), reason: 'pr_merged', supersededBy: null, expiredAt: at(41) });
    store.facts.close('f1', { invalidAt: at(90), reason: 'again', supersededBy: 'x', expiredAt: at(91) });
    expect(store.facts.get('f1')).toMatchObject({ invalidAt: at(40), invalidReason: 'pr_merged', supersededBy: null, expiredAt: at(41) });
    expect(store.facts.listActiveForTopic('topic-1')).toEqual([]);
  });

  it('marks stale, keeps the first reason, and clears on verify', () => {
    store.facts.add(makeFact());
    store.facts.markStale('f1', 'head_moved', at(50));
    store.facts.markStale('f1', 'pr_missing', at(60));
    expect(store.facts.get('f1')).toMatchObject({ staleAt: at(50), staleReason: 'head_moved' });
    expect(store.facts.listStaleToRecheck('topic-1', 10).map((f) => f.id)).toEqual(['f1']);

    store.facts.markVerified(['f1'], at(70));
    expect(store.facts.get('f1')).toMatchObject({ staleAt: null, staleReason: null, verifiedAt: at(70) });
    expect(store.facts.listStaleToRecheck('topic-1', 10)).toEqual([]);
    store.facts.markVerified([], at(80));
  });

  it('offers a stale fact for recheck once per time it goes stale', () => {
    store.facts.add(makeFact());
    store.facts.add(makeFact({ id: 'f2' }));
    store.facts.markStale('f1', 'source_deleted', at(50));
    store.facts.markStale('f2', 'source_deleted', at(51));
    expect(store.facts.listStaleToRecheck('topic-1', 1).map((f) => f.id)).toEqual(['f2']);

    store.facts.markRechecked(['f1', 'f2'], at(60));
    expect(store.facts.listStaleToRecheck('topic-1', 10)).toEqual([]);

    store.facts.markVerified(['f1'], at(70));
    store.facts.markStale('f1', 'head_moved', at(80));
    expect(store.facts.listStaleToRecheck('topic-1', 10).map((f) => f.id)).toEqual(['f1']);
  });

  it('moves pinned heads of refs, and leaves unpinned refs alone', () => {
    store.facts.add(makeFact({ refs: [makeFactRef({ headOid: 'h0' }), makeFactRef({ kind: 'comment', sourceId: 'c1' })] }));
    store.facts.reanchorRefs('f1', new Map([['acme/app#1', 'h1']]));
    expect(store.facts.get('f1')?.refs.map((ref) => [ref.kind, ref.headOid])).toEqual([
      ['comment', null],
      ['pr', 'h1'],
    ]);
  });

  it('queries active facts newest first, with filters and "changed since"', () => {
    store.facts.add(makeFact({ id: 'old', recordedAt: at(1) }));
    store.facts.add(makeFact({ id: 'new', recordedAt: at(30), predicate: 'reviews' }));
    store.facts.add(makeFact({ id: 'gone', recordedAt: at(2), invalidAt: at(40), expiredAt: at(40) }));
    store.facts.add(makeFact({ id: 'bob', subject: { kind: 'person', key: 'bob' }, recordedAt: at(3), topicId: 'topic-2' }));

    expect(store.facts.query({}).map((f) => f.id)).toEqual(['new', 'bob', 'old']);
    expect(store.facts.query({ includeClosed: true }).map((f) => f.id)).toEqual(['new', 'bob', 'gone', 'old']);
    expect(store.facts.query({ entity: alice }).map((f) => f.id)).toEqual(['new', 'old']);
    expect(store.facts.query({ predicate: 'reviews' }).map((f) => f.id)).toEqual(['new']);
    expect(store.facts.query({ topicId: 'topic-2' }).map((f) => f.id)).toEqual(['bob']);
    expect(store.facts.query({ changedSince: at(20) }).map((f) => f.id)).toEqual(['new', 'gone']);
    expect(store.facts.query({ limit: 1 }).map((f) => f.id)).toEqual(['new']);
  });
});

describe('Depot: a push on #1902 after approval', () => {
  it('closes "Alice approved #1902" with the new status as its successor', () => {
    const key = 'acme/app#1902';
    const approved = makeFact({
      id: 'approved',
      subject: { kind: 'pr', key },
      predicate: 'status',
      object: null,
      text: `Alice approved ${key}`,
      refs: [makeFactRef({ kind: 'review', prKey: key, sourceId: 'r1', at: at(5), headOid: 'c1' })],
      validFrom: at(5),
      recordedAt: at(6),
    });
    store.facts.add(approved);
    store.facts.markStale('approved', 'head_moved', at(21));

    const pushed = makeFact({
      id: 'pushed',
      subject: { kind: 'pr', key },
      predicate: 'status',
      object: null,
      text: `new commits on ${key} after Alice's approval`,
      refs: [makeFactRef({ kind: 'commit', prKey: key, sourceId: 'c2', at: at(20), headOid: 'c2' })],
      validFrom: at(20),
      recordedAt: at(22),
    });
    store.transaction(() => {
      store.facts.add(pushed);
      store.facts.close('approved', { invalidAt: at(20), reason: 'new push after approval', supersededBy: 'pushed', expiredAt: at(22) });
    });

    expect(store.facts.listActiveTouchingPrs([key]).map((f) => f.id)).toEqual(['pushed']);
    expect(store.facts.get('approved')).toMatchObject({ invalidAt: at(20), supersededBy: 'pushed', staleReason: 'head_moved' });
    expect(store.facts.query({ changedSince: at(10) }).map((f) => f.id)).toEqual(['pushed', 'approved']);
  });
});

describe('RuleProposalRepo', () => {
  const base = { text: 'Treat Renovate bumps as not mine', topicId: null, evidenceFeedbackIds: [1, 4], reason: 'three not_mine', status: 'pending' as const, decidedAt: null };

  it('lists pending, decides once, and serves accepted global rules', () => {
    store.ruleProposals.add({ ...base, id: 'r1', createdAt: at(1) });
    store.ruleProposals.add({ ...base, id: 'r2', topicId: 'topic-1', createdAt: at(2) });
    store.ruleProposals.add({ ...base, id: 'r3', createdAt: at(3) });
    expect(store.ruleProposals.get('r1')).toEqual({ ...base, id: 'r1', createdAt: at(1) });
    expect(store.ruleProposals.listPending().map((p) => p.id)).toEqual(['r1', 'r2', 'r3']);

    store.ruleProposals.decide('r1', 'accepted', at(10));
    store.ruleProposals.decide('r1', 'rejected', at(11));
    store.ruleProposals.decide('r2', 'accepted', at(12));
    store.ruleProposals.decide('r3', 'rejected', at(13));

    expect(store.ruleProposals.get('r1')).toMatchObject({ status: 'accepted', decidedAt: at(10) });
    expect(store.ruleProposals.listPending()).toEqual([]);
    expect(store.ruleProposals.listAcceptedGlobal().map((p) => p.id)).toEqual(['r1']);
    expect(store.ruleProposals.listDecided(2).map((p) => p.id)).toEqual(['r3', 'r2']);
  });
});

describe('AgentCallRepo', () => {
  it('builds run stats from rows and finds the last good call', () => {
    const call = { runId: 'sync-1', topicId: 'topic-1', model: 'claude-sonnet-4-5', ok: true, attempt: 1, durationMs: 1000, costUsd: 0.02, at: at(1) };
    store.agentCalls.add({ ...call, kind: 'dossier_update' });
    store.agentCalls.add({ ...call, kind: 'dossier_update', ok: false, costUsd: null, at: at(2) });
    store.agentCalls.add({ ...call, kind: 'glance_batch', attempt: 2, costUsd: 0.01, at: at(3) });
    store.agentCalls.add({ ...call, runId: 'sync-2', kind: 'consolidation', at: at(4) });

    const stats = store.agentCalls.statsForRun('sync-1');
    expect(stats.total).toBe(3);
    expect(stats.byKind.dossier_update).toMatchObject({ calls: 2, failed: 1, durationMs: 2000, costUsd: 0.02 });
    expect(stats.byKind.glance_batch).toMatchObject({ calls: 1, retries: 1, costUsd: 0.01 });
    expect(store.agentCalls.statsForRun('none')).toEqual({ total: 0, byKind: {} });

    expect(store.agentCalls.lastOkAt('dossier_update')).toBe(at(1));
    expect(store.agentCalls.lastOkAt('consolidation')).toBe(at(4));
    expect(store.agentCalls.lastOkAt('fact_reconcile')).toBeNull();
    expect(store.agentCalls.countSince('dossier_update', at(2))).toBe(1);
    expect(store.agentCalls.countSince('dossier_update', at(0))).toBe(2);
  });
});
