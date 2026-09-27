import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrSet, Topic } from '@code-manager/core';
import { at, makeEvent, makePr, makeThreadFor } from '@code-manager/core/fixtures';
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
    tailoring: '',
    driver: 'alice',
    userRole: 'reviewer',
    status: 'active',
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

function makeSet(overrides: Partial<PrSet> = {}): PrSet {
  return {
    id: 'set-1',
    topicId: 'topic-1',
    title: 'Runner moves',
    take: 'all move jobs to depot',
    members: [
      { prKey: 'PostHog/posthog#1', reason: 'build job' },
      { prKey: 'PostHog/posthog#2', reason: 'test job' },
      { prKey: 'PostHog/posthog#3', reason: 'lint job' },
    ],
    removedKeys: [],
    status: 'active',
    inputHash: 'h1',
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

describe('MetaRepo', () => {
  it('stores and overwrites values', () => {
    expect(store.meta.get('etag')).toBeNull();
    store.meta.set('etag', 'W/"1"');
    store.meta.set('etag', 'W/"2"');
    expect(store.meta.get('etag')).toBe('W/"2"');
    store.meta.delete('etag');
    expect(store.meta.get('etag')).toBeNull();
  });
});

describe('NotificationRepo', () => {
  it('upserts threads and finds them by PR key', () => {
    const pr = makePr({ number: 7 });
    store.notifications.upsertMany([makeThreadFor(pr)]);
    store.notifications.upsertMany([makeThreadFor(pr, { reason: 'mention' })]);
    expect(store.notifications.list()).toHaveLength(1);
    expect(store.notifications.getByPrKey(pr.key)).toMatchObject({ reason: 'mention', unread: true });
    expect(store.notifications.getByPrKeys([pr.key, 'x/y#1']).size).toBe(1);
  });

  it('does not map non-PR threads to a PR key', () => {
    const release = { ...makeThreadFor(makePr()), id: 'rel', subjectType: 'Release', number: null };
    store.notifications.upsertMany([release]);
    expect(store.notifications.list()).toHaveLength(1);
    expect(store.notifications.getByPrKey('PostHog/posthog#1')).toBeNull();
  });

  it('mirrors a mark-read locally', () => {
    const thread = makeThreadFor(makePr());
    store.notifications.upsertMany([thread]);
    store.notifications.markRead(thread.id, at(5));
    expect(store.notifications.getByPrKey('PostHog/posthog#1')).toMatchObject({ unread: false, lastReadAt: at(5) });
  });
});

describe('PrRepo', () => {
  it('round-trips the full snapshot and lists by repo', () => {
    const pr = makePr({ number: 2, labels: ['devex'], checks: { rollup: 'SUCCESS', contexts: [] } });
    store.prs.upsert(pr, at(1));
    store.prs.upsert(makePr({ number: 1 }), at(1));
    store.prs.upsert(makePr({ number: 9, repo: 'PostHog/other' }), at(1));
    expect(store.prs.get(pr.key)).toEqual(pr);
    expect(store.prs.get('nope/nope#1')).toBeNull();
    expect(store.prs.listByRepo('PostHog/posthog').map((p) => p.ref.number)).toEqual([1, 2]);
    expect(store.prs.getMany([pr.key, 'PostHog/other#9']).size).toBe(2);
    expect(store.prs.listAll()).toHaveLength(3);
  });

  it('replaces the snapshot and reports updated_at per key', () => {
    store.prs.upsert(makePr({ updatedAt: at(1) }), at(1));
    store.prs.upsert(makePr({ updatedAt: at(2), title: 'renamed' }), at(2));
    expect(store.prs.get('PostHog/posthog#1')?.title).toBe('renamed');
    expect(store.prs.updatedAtByKey()).toEqual(new Map([['PostHog/posthog#1', at(2)]]));
  });
});

describe('EventRepo', () => {
  const key = 'PostHog/posthog#1';

  it('returns only new ids and keeps seen and override state across re-derivation', () => {
    const first = makeEvent({ id: 'e1', at: at(1) });
    expect(store.events.upsertDerived(key, [first])).toEqual(['e1']);
    store.events.markSeen(['e1'], at(2));
    store.events.setOverride('e1', { loudness: 'muted', reason: 'noise', by: 'agent' });

    const again = makeEvent({ id: 'e1', at: at(1), summary: 'edited' });
    const second = makeEvent({ id: 'e2', at: at(3) });
    expect(store.events.upsertDerived(key, [again, second])).toEqual(['e2']);

    const [e1, e2] = store.events.listForPr(key);
    expect(e1).toMatchObject({
      id: 'e1',
      summary: 'edited',
      seenAt: at(2),
      override: { loudness: 'muted', reason: 'noise', by: 'agent' },
    });
    expect(e2).toMatchObject({ id: 'e2', seenAt: null, override: null });
  });

  it('drops events the new snapshot no longer produces', () => {
    store.events.upsertDerived(key, [makeEvent({ id: 'e1' }), makeEvent({ id: 'e2' })]);
    store.events.upsertDerived(key, [makeEvent({ id: 'e2' })]);
    expect(store.events.listForPr(key).map((e) => e.id)).toEqual(['e2']);
  });

  it('keeps the first seen time and can clear it for undo', () => {
    store.events.upsertDerived(key, [makeEvent({ id: 'e1' })]);
    store.events.markSeen(['e1'], at(2));
    store.events.markSeen(['e1'], at(9));
    expect(store.events.listForPr(key)[0]?.seenAt).toBe(at(2));
    store.events.clearSeen(['e1']);
    expect(store.events.listForPr(key)[0]?.seenAt).toBeNull();
  });

  it('clears an override (unmute)', () => {
    store.events.upsertDerived(key, [makeEvent({ id: 'e1' })]);
    store.events.setOverride('e1', { loudness: 'muted', reason: 'noise', by: 'agent' });
    store.events.setOverride('e1', null);
    expect(store.events.listForPr(key)[0]?.override).toBeNull();
  });

  it('lists events for many PRs, oldest first, with empty lists for PRs without events', () => {
    store.events.upsertDerived(key, [makeEvent({ id: 'b', at: at(5) }), makeEvent({ id: 'a', at: at(1) })]);
    const map = store.events.listForPrs([key, 'PostHog/posthog#2']);
    expect(map.get(key)?.map((e) => e.id)).toEqual(['a', 'b']);
    expect(map.get('PostHog/posthog#2')).toEqual([]);
  });
});

describe('UserPrStateRepo', () => {
  it('tracks approval and handled state independently', () => {
    const key = 'PostHog/posthog#1';
    store.userPrStates.markHandled(key, at(1));
    store.userPrStates.markApproved(key, 'abc', at(2));
    expect(store.userPrStates.get(key)).toEqual({
      prKey: key,
      approvedAt: at(2),
      approvedCommitOid: 'abc',
      handledAt: at(1),
    });
    store.userPrStates.clearHandled(key);
    expect(store.userPrStates.get(key)?.handledAt).toBeNull();
    expect(store.userPrStates.getMany([key, 'x/y#2']).size).toBe(1);
  });
});

describe('TopicRepo and memberships', () => {
  it('creates, updates and lists topics', () => {
    store.topics.create(makeTopic());
    store.topics.create(makeTopic({ id: 'topic-2', name: 'Old', createdAt: at(1) }));
    store.topics.updateSummary('topic-1', 'Moving CI', 'sh1', at(2));
    store.topics.setTailoring('topic-1', 'Only flag runner cost changes', at(3));
    store.topics.rename('topic-1', 'Depot migration', at(4));
    store.topics.setDriverAndRole('topic-1', 'bob', 'driver', at(5));
    store.topics.setStatus('topic-2', 'archived', at(6));
    expect(store.topics.get('topic-1')).toMatchObject({
      name: 'Depot migration',
      summary: 'Moving CI',
      summaryInputHash: 'sh1',
      tailoring: 'Only flag runner cost changes',
      driver: 'bob',
      userRole: 'driver',
      updatedAt: at(5),
    });
    expect(store.topics.list().map((t) => t.id)).toEqual(['topic-1', 'topic-2']);
    expect(store.topics.listActive().map((t) => t.id)).toEqual(['topic-1']);
  });

  it('assigns PRs, lists unassigned ones, and moves them on merge', () => {
    store.topics.create(makeTopic());
    store.topics.create(makeTopic({ id: 'topic-2' }));
    store.prs.upsert(makePr({ number: 1 }), at(0));
    store.prs.upsert(makePr({ number: 2 }), at(0));
    store.memberships.assign({
      prKey: 'PostHog/posthog#1',
      topicId: 'topic-1',
      assignedBy: 'agent',
      reason: 'depot',
      createdAt: at(1),
    });
    expect(store.memberships.listUnassignedPrKeys()).toEqual(['PostHog/posthog#2']);
    store.memberships.assign({
      prKey: 'PostHog/posthog#1',
      topicId: 'topic-2',
      assignedBy: 'user',
      reason: 'moved',
      createdAt: at(2),
    });
    expect(store.memberships.get('PostHog/posthog#1')).toMatchObject({ topicId: 'topic-2', assignedBy: 'user' });
    store.memberships.moveAll('topic-2', 'topic-1');
    expect(store.memberships.listForTopic('topic-1').map((m) => m.prKey)).toEqual(['PostHog/posthog#1']);
    store.memberships.remove('PostHog/posthog#1');
    expect(store.memberships.listAll()).toEqual([]);
  });

  it('refuses a membership for a topic that does not exist', () => {
    expect(() =>
      store.memberships.assign({ prKey: 'a/b#1', topicId: 'ghost', assignedBy: 'agent', reason: '', createdAt: at(0) }),
    ).toThrow();
  });
});

describe('TopicProposalRepo', () => {
  it('stores proposals and decides each only once', () => {
    store.proposals.add({
      id: 'p1',
      kind: 'new_topic',
      topicId: null,
      name: 'Flaky tests',
      intoTopicId: null,
      prKeys: ['PostHog/posthog#1'],
      reason: 'three PRs fix flakes',
      status: 'pending',
      createdAt: at(0),
      decidedAt: null,
    });
    store.proposals.add({
      id: 'p2',
      kind: 'merge',
      topicId: 'topic-2',
      name: null,
      intoTopicId: 'topic-1',
      prKeys: [],
      reason: 'same work',
      status: 'pending',
      createdAt: at(1),
      decidedAt: null,
    });
    expect(store.proposals.get('p1')?.prKeys).toEqual(['PostHog/posthog#1']);
    expect(store.proposals.listPendingForTopic('topic-1').map((p) => p.id)).toEqual(['p2']);
    store.proposals.decide('p1', 'accepted', at(2));
    store.proposals.decide('p1', 'rejected', at(3));
    expect(store.proposals.get('p1')).toMatchObject({ status: 'accepted', decidedAt: at(2) });
    expect(store.proposals.listPending().map((p) => p.id)).toEqual(['p2']);
  });
});

describe('PrSetRepo', () => {
  beforeEach(() => {
    store.topics.create(makeTopic());
  });

  it('saves a set with ordered members and replaces them on save', () => {
    store.sets.save(makeSet());
    expect(store.sets.get('set-1')?.members.map((m) => m.reason)).toEqual(['build job', 'test job', 'lint job']);
    store.sets.save(makeSet({ members: [{ prKey: 'PostHog/posthog#3', reason: 'lint' }], inputHash: 'h2' }));
    expect(store.sets.get('set-1')).toMatchObject({ inputHash: 'h2', members: [{ prKey: 'PostHog/posthog#3' }] });
  });

  it('drops a member on "not related" and dissolves the set below two members', () => {
    store.sets.save(makeSet());
    store.sets.removeMember('set-1', 'PostHog/posthog#2', at(1));
    expect(store.sets.get('set-1')).toMatchObject({ status: 'active', removedKeys: ['PostHog/posthog#2'] });
    expect(store.sets.get('set-1')?.members.map((m) => m.prKey)).toEqual(['PostHog/posthog#1', 'PostHog/posthog#3']);
    // A save that lists the removed PR again does not bring it back.
    store.sets.save(makeSet({ inputHash: 'h2' }));
    expect(store.sets.get('set-1')?.members.map((m) => m.prKey)).toEqual(['PostHog/posthog#1', 'PostHog/posthog#3']);
    store.sets.removeMember('set-1', 'PostHog/posthog#3', at(2));
    expect(store.sets.get('set-1')).toMatchObject({ status: 'dissolved', updatedAt: at(2) });
    expect(store.sets.listActiveForTopic('topic-1')).toEqual([]);
    expect(store.sets.listForTopic('topic-1')).toHaveLength(1);
  });

  it('keeps dissolved sets, and finds active sets by PR', () => {
    store.sets.save(makeSet());
    store.sets.save(makeSet({ id: 'set-2', members: [{ prKey: 'PostHog/posthog#1', reason: 'x' }] }));
    store.sets.dissolve('set-2', at(1));
    expect(store.sets.listActiveForPr('PostHog/posthog#1').map((s) => s.id)).toEqual(['set-1']);
    expect(store.sets.get('set-2')?.members).toHaveLength(1);
  });
});

describe('GlanceRepo', () => {
  it('keeps the latest glance per PR', () => {
    const glance = {
      prKey: 'PostHog/posthog#1',
      verdict: 'LOOKS_SAFE' as const,
      forYou: 'Runner label change only.',
      does: 'Moves tests to depot',
      risk: 'low',
      othersSaid: 'bob approved',
      pullInReason: null,
      inputHash: 'h1',
      model: 'claude-haiku-4-5',
      createdAt: at(0),
    };
    store.glances.put(glance);
    store.glances.put({ ...glance, verdict: 'LOOK_CLOSER', inputHash: 'h2' });
    expect(store.glances.get(glance.prKey)).toMatchObject({ verdict: 'LOOK_CLOSER', inputHash: 'h2' });
    expect(store.glances.getMany([glance.prKey, 'x/y#1']).size).toBe(1);
    expect(store.glances.get('x/y#1')).toBeNull();
  });
});

describe('SnoozeRepo', () => {
  it('stores one snooze per tile with its condition', () => {
    store.snoozes.put({ tileId: 'pr:a/b#1', condition: { kind: 'new_push' }, since: at(0) });
    store.snoozes.put({ tileId: 'pr:a/b#1', condition: { kind: 'until_time', until: at(60) }, since: at(1) });
    expect(store.snoozes.get('pr:a/b#1')).toEqual({
      tileId: 'pr:a/b#1',
      condition: { kind: 'until_time', until: at(60) },
      since: at(1),
    });
    expect(store.snoozes.list()).toHaveLength(1);
    store.snoozes.remove('pr:a/b#1');
    expect(store.snoozes.get('pr:a/b#1')).toBeNull();
  });
});

describe('FeedbackRepo', () => {
  it('returns the newest N per topic and across topics', () => {
    const base = { tileId: null, prKey: null, setId: null, eventId: null, note: '' };
    store.feedback.add({ ...base, kind: 'not_mine', topicId: 'topic-1', createdAt: at(1) });
    store.feedback.add({ ...base, kind: 'wrong_topic', topicId: 'topic-2', createdAt: at(2) });
    const last = store.feedback.add({ ...base, kind: 'not_related', topicId: 'topic-1', prKey: 'a/b#1', createdAt: at(3) });
    expect(last.id).toBeGreaterThan(0);
    expect(store.feedback.recentForTopic('topic-1', 10).map((f) => f.kind)).toEqual(['not_related', 'not_mine']);
    expect(store.feedback.recentForTopic('topic-1', 1).map((f) => f.kind)).toEqual(['not_related']);
    expect(store.feedback.recent(2).map((f) => f.kind)).toEqual(['not_related', 'wrong_topic']);
    expect(store.feedback.listForPr('a/b#1')).toHaveLength(1);
  });
});

describe('ChatRepo', () => {
  it('appends messages and lists them oldest first', () => {
    store.chat.add({ tileId: 't1', topicId: 'topic-1', role: 'user', text: 'why is this mine?', createdAt: at(0) });
    const reply = store.chat.add({ tileId: 't1', topicId: 'topic-1', role: 'agent', text: 'team review', createdAt: at(1) });
    store.chat.add({ tileId: 't2', topicId: 'topic-1', role: 'user', text: 'other', createdAt: at(2) });
    expect(reply.id).toBeGreaterThan(0);
    expect(store.chat.listForTile('t1').map((m) => m.role)).toEqual(['user', 'agent']);
  });
});

describe('AgentCacheRepo', () => {
  it('stores answers by key', () => {
    expect(store.agentCache.get('k')).toBeNull();
    store.agentCache.put({ key: 'k', purpose: 'assign', model: 'sonnet', output: '{"a":1}', createdAt: at(0) });
    expect(store.agentCache.get('k')).toMatchObject({ purpose: 'assign', output: '{"a":1}' });
  });
});

describe('Store.transaction', () => {
  it('rolls back every write when the function throws', () => {
    expect(() =>
      store.transaction(() => {
        store.meta.set('a', '1');
        store.prs.upsert(makePr(), at(0));
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(store.meta.get('a')).toBeNull();
    expect(store.prs.get('PostHog/posthog#1')).toBeNull();
    expect(store.db.isTransaction).toBe(false);
  });

  it('lets repositories that use transactions join an outer one', () => {
    store.topics.create(makeTopic());
    expect(() =>
      store.transaction(() => {
        store.sets.save(makeSet());
        store.events.upsertDerived('PostHog/posthog#1', [makeEvent({ id: 'e1' })]);
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(store.sets.get('set-1')).toBeNull();
    expect(store.events.listForPr('PostHog/posthog#1')).toEqual([]);
  });

  it('commits and returns the value on success', () => {
    const value = store.transaction(() => {
      store.meta.set('a', '1');
      return 42;
    });
    expect(value).toBe(42);
    expect(store.meta.get('a')).toBe('1');
  });
});
