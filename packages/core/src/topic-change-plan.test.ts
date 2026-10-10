import { describe, expect, it } from 'vitest';
import { planTopicChange, type TopicChangeRequest, type TopicChangeSnapshot } from './topic-change-plan.ts';
import type { PrKey, TopicProposal } from './types.ts';

const NOW = '2026-09-29T12:00:00.000Z';

/** Topic depot shows #1851 <- #1902 <- #1911 (a stack), #1904 and #1921; topic ci shows #1822. */
function snapshot(overrides: Partial<TopicChangeSnapshot> = {}): TopicChangeSnapshot {
  const stack: PrKey[] = ['acme/app#1851', 'acme/app#1902', 'acme/app#1911'];
  const depot: PrKey[] = [...stack, 'acme/app#1904', 'acme/app#1921'];
  return {
    now: NOW,
    topic: { id: 'depot', name: 'Move CI to Depot', status: 'active' },
    intoTopic: null,
    members: depot,
    topicIdOf: (key) => (depot.includes(key) ? 'depot' : key === 'acme/app#1822' ? 'ci' : null),
    movesWith: (key) => (stack.includes(key) ? stack : [key]),
    isDone: () => false,
    proposals: [],
    pendingFromAgents: [],
    filedLastDay: 0,
    ...overrides,
  };
}

function change(overrides: Partial<TopicChangeRequest>): TopicChangeRequest {
  return { topicId: 'depot', kind: 'split', prKeys: ['acme/app#1902'], name: 'Turbo cache', intoTopicId: null, reason: 'separate work', dryRun: false, ...overrides };
}

function filed(overrides: Partial<TopicProposal>): TopicProposal {
  return {
    id: 'p',
    kind: 'split',
    topicId: 'depot',
    name: 'Turbo cache',
    intoTopicId: null,
    fromArea: null,
    prKeys: [],
    reason: '',
    status: 'pending',
    createdAt: '2026-09-28T12:00:00.000Z',
    decidedAt: null,
    source: 'agent',
    client: 'claude-code',
    ...overrides,
  };
}

describe('planTopicChange', () => {
  it('previews a split with the stack it brings along and what stays', () => {
    expect(planTopicChange(change({}), snapshot())).toEqual({
      ok: true,
      movedPrKeys: ['acme/app#1851', 'acme/app#1902', 'acme/app#1911'],
      preview: [
        'Split 3 open PRs out of "Move CI to Depot" into a new topic "Turbo cache": acme/app#1851, acme/app#1902, acme/app#1911.',
        'acme/app#1902 brings acme/app#1851 and acme/app#1911 along (same stack).',
        '2 PRs stay in "Move CI to Depot".',
      ],
    });
  });

  it('refuses a split of PRs from another topic, or one that moves every PR', () => {
    expect(planTopicChange(change({ prKeys: ['acme/app#1822'] }), snapshot())).toEqual({
      ok: false,
      reason: 'acme/app#1822 is not in "Move CI to Depot"; a split only moves PRs out of their own topic.',
    });
    const all = planTopicChange(change({ prKeys: ['acme/app#1902', 'acme/app#1904', 'acme/app#1921'] }), snapshot());
    expect(all).toMatchObject({ ok: false, reason: expect.stringContaining('propose a rename or a merge instead') });
  });

  it('previews a rename and a merge, and refuses one into an inactive topic', () => {
    expect(planTopicChange(change({ kind: 'rename', prKeys: [], name: 'Depot runners' }), snapshot())).toMatchObject({ ok: true, preview: ['Rename "Move CI to Depot" to "Depot runners".'] });
    expect(planTopicChange(change({ kind: 'rename', prKeys: [], name: ' move ci to depot ' }), snapshot())).toMatchObject({ ok: false });
    const into = { id: 'ci', name: 'CI & tests', status: 'active' as const };
    expect(planTopicChange(change({ kind: 'merge', prKeys: [], name: null, intoTopicId: 'ci' }), snapshot({ intoTopic: into }))).toMatchObject({
      ok: true,
      movedPrKeys: ['acme/app#1851', 'acme/app#1902', 'acme/app#1911', 'acme/app#1904', 'acme/app#1921'],
      preview: ['Merge "Move CI to Depot" (5 PRs) into "CI & tests"; "Move CI to Depot" is archived.'],
    });
    expect(planTopicChange(change({ kind: 'merge', prKeys: [], name: null, intoTopicId: 'ci' }), snapshot({ intoTopic: { ...into, status: 'retired' } }))).toMatchObject({ ok: false });
  });

  describe('move', () => {
    const ci = { id: 'ci', name: 'CI & tests', status: 'active' as const };
    const move = (overrides: Partial<TopicChangeRequest> = {}) => change({ kind: 'move', name: null, intoTopicId: 'ci', ...overrides });

    it('previews a move into an existing topic with the stack it brings along and what stays', () => {
      expect(planTopicChange(move({ prKeys: ['acme/app#1902', 'acme/app#1904'] }), snapshot({ intoTopic: ci }))).toEqual({
        ok: true,
        movedPrKeys: ['acme/app#1851', 'acme/app#1902', 'acme/app#1911', 'acme/app#1904'],
        preview: [
          'Move 4 open PRs from "Move CI to Depot" into "CI & tests": acme/app#1851, acme/app#1902, acme/app#1911, acme/app#1904.',
          'acme/app#1902 brings acme/app#1851 and acme/app#1911 along (same stack).',
          '1 PR stays in "Move CI to Depot".',
        ],
      });
    });

    it('refuses PRs from another topic and a move that empties the topic', () => {
      expect(planTopicChange(move({ prKeys: ['acme/app#1822'] }), snapshot({ intoTopic: ci }))).toEqual({
        ok: false,
        reason: 'acme/app#1822 is not in "Move CI to Depot"; a move only moves PRs out of their own topic.',
      });
      expect(planTopicChange(move({ prKeys: ['acme/app#1902', 'acme/app#1904', 'acme/app#1921'] }), snapshot({ intoTopic: ci }))).toEqual({
        ok: false,
        reason: 'That would move every PR out of "Move CI to Depot"; propose a merge instead.',
      });
    });

    it('needs an active target that is not the source, and says which of the three failed', () => {
      expect(planTopicChange(move(), snapshot())).toEqual({ ok: false, reason: 'PostPile has no topic ci.' });
      expect(planTopicChange(move(), snapshot({ intoTopic: { ...ci, status: 'archived' } }))).toEqual({ ok: false, reason: 'ci is archived; into_topic must be an active topic.' });
      const self = { ok: false, reason: 'into_topic must be a different topic than topic; both are depot.' };
      expect(planTopicChange(move({ intoTopicId: 'depot' }), snapshot({ intoTopic: { id: 'depot', name: 'Move CI to Depot', status: 'active' } }))).toEqual(self);
      expect(planTopicChange(change({ kind: 'merge', prKeys: [], name: null, intoTopicId: 'depot' }), snapshot({ intoTopic: { id: 'depot', name: 'Move CI to Depot', status: 'active' } }))).toEqual(self);
      expect(planTopicChange(move({ intoTopicId: null }), snapshot())).toEqual({ ok: false, reason: 'move needs into_topic: the existing topic the PRs go to.' });
      expect(planTopicChange(move({ prKeys: [] }), snapshot({ intoTopic: ci }))).toEqual({ ok: false, reason: 'move needs prs: the PRs to move out of the topic.' });
    });

    it('refuses the same move pending or rejected, and lets a different PR set or target through', () => {
      const same = filed({ kind: 'move', name: null, intoTopicId: 'ci', prKeys: ['acme/app#1904', 'acme/app#1902'] });
      const request = move({ prKeys: ['acme/app#1902', 'acme/app#1904'] });
      expect(planTopicChange(request, snapshot({ intoTopic: ci, proposals: [same] }))).toMatchObject({ ok: false, reason: expect.stringContaining('pending already') });
      const rejected = { ...same, status: 'rejected' as const, decidedAt: '2026-09-20T08:00:00.000Z' };
      expect(planTopicChange(request, snapshot({ intoTopic: ci, proposals: [rejected] }))).toMatchObject({ ok: false, reason: expect.stringContaining('rejected this change') });
      expect(planTopicChange(move({ prKeys: ['acme/app#1904'] }), snapshot({ intoTopic: ci, proposals: [rejected] })).ok).toBe(true);
      const elsewhere = { ...rejected, intoTopicId: 'docs' };
      expect(planTopicChange(request, snapshot({ intoTopic: ci, proposals: [elsewhere] })).ok).toBe(true);
    });

    it('treats another layer of a rejected or pending stack as the same move', () => {
      const rejected = filed({ kind: 'move', name: null, intoTopicId: 'ci', prKeys: ['acme/app#1911'], status: 'rejected', decidedAt: '2026-09-20T08:00:00.000Z' });
      expect(planTopicChange(move({ prKeys: ['acme/app#1851'] }), snapshot({ intoTopic: ci, proposals: [rejected] }))).toMatchObject({ ok: false, reason: expect.stringContaining('rejected this change') });
      const pending = { ...rejected, status: 'pending' as const, decidedAt: null };
      expect(planTopicChange(move({ prKeys: ['acme/app#1902'] }), snapshot({ intoTopic: ci, proposals: [pending] }))).toMatchObject({ ok: false, reason: expect.stringContaining('pending already') });
      // The stack plus another PR is a different set.
      expect(planTopicChange(move({ prKeys: ['acme/app#1902', 'acme/app#1904'] }), snapshot({ intoTopic: ci, proposals: [rejected] })).ok).toBe(true);
    });

    it('counts only open PRs as moved and names the merged and closed layers that go along', () => {
      const done = new Set(['acme/app#1851', 'acme/app#1911']);
      expect(planTopicChange(move({ prKeys: ['acme/app#1902'] }), snapshot({ intoTopic: ci, isDone: (key) => done.has(key) }))).toEqual({
        ok: true,
        movedPrKeys: ['acme/app#1902'],
        preview: [
          'Move 1 open PR from "Move CI to Depot" into "CI & tests": acme/app#1902.',
          'Merged and closed layers of the same stack go along too: acme/app#1851 and acme/app#1911.',
          '2 PRs stay in "Move CI to Depot".',
        ],
      });
    });
  });

  it('checks the fields and that the topic is active', () => {
    expect(planTopicChange(change({ reason: ' ' }), snapshot())).toMatchObject({ ok: false, reason: 'reason is required, at most 300 characters.' });
    expect(planTopicChange(change({ reason: 'x'.repeat(301) }), snapshot())).toMatchObject({ ok: false });
    expect(planTopicChange(change({ name: null }), snapshot())).toMatchObject({ ok: false, reason: 'split needs name, at most 80 characters.' });
    expect(planTopicChange(change({ name: 'word '.repeat(17) }), snapshot())).toMatchObject({ ok: false, reason: 'split needs name, at most 80 characters.' });
    expect(planTopicChange(change({ name: 'x'.repeat(80) }), snapshot()).ok).toBe(true);
    expect(planTopicChange(change({ name: '\u0000\u0007' }), snapshot())).toMatchObject({ ok: false, reason: 'The name is empty after cleaning.' });
    expect(planTopicChange(change({ prKeys: [] }), snapshot())).toMatchObject({ ok: false, reason: 'split needs prs: the PRs to move out of the topic.' });
    expect(planTopicChange(change({ kind: 'merge', name: null }), snapshot())).toMatchObject({ ok: false, reason: 'merge needs into_topic: the topic to merge into.' });
    expect(planTopicChange(change({}), snapshot({ topic: { id: 'depot', name: 'x', status: 'archived' } }))).toMatchObject({ ok: false, reason: 'PostPile has no active topic depot.' });
  });

  it('refuses a change that is pending already or was rejected before', () => {
    expect(planTopicChange(change({}), snapshot({ proposals: [filed({})] }))).toMatchObject({ ok: false, reason: expect.stringContaining('pending already (filed 2026-09-28)') });
    const rejected = filed({ status: 'rejected', decidedAt: '2026-09-20T08:00:00.000Z', source: 'consolidation', client: null });
    expect(planTopicChange(change({ name: 'turbo CACHE' }), snapshot({ proposals: [rejected] }))).toEqual({
      ok: false,
      reason: "The user rejected this change on 2026-09-20; don't propose it again.",
    });
    // An expired one does not block a new try.
    const expired = filed({ createdAt: '2026-09-01T00:00:00.000Z' });
    expect(planTopicChange(change({}), snapshot({ proposals: [expired], pendingFromAgents: [expired] })).ok).toBe(true);
  });

  it('caps outside suggestions per topic, in total and per day', () => {
    const pending = (n: number, topicId: string) => Array.from({ length: n }, (_, i) => filed({ id: `p${topicId}${i}`, topicId, name: `n${i}` }));
    expect(planTopicChange(change({}), snapshot({ pendingFromAgents: pending(3, 'depot') }))).toMatchObject({ ok: false, reason: expect.stringContaining('already has 3 outside suggestions') });
    expect(planTopicChange(change({}), snapshot({ pendingFromAgents: [...pending(2, 'depot'), ...pending(8, 'ci')] }))).toMatchObject({ ok: false, reason: expect.stringContaining('10 outside suggestions') });
    expect(planTopicChange(change({}), snapshot({ filedLastDay: 20 }))).toMatchObject({ ok: false, reason: expect.stringContaining('try again tomorrow') });
  });
});
