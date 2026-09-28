import { makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { deferredKey, MAX_NEW_TOPICS_PER_SYNC } from './topic-assignment.ts';

const prs = Array.from({ length: 8 }, (_, index) => reviewRequestedPr(index + 1));

function setup() {
  const h = makeHarness();
  for (const pr of prs) {
    h.reader.addPr(pr, makeThreadFor(pr));
  }
  return h;
}

describe('topic assignment against fragmentation', () => {
  it('creates at most the cap of new topics per sync and leaves the rest in Unsorted', async () => {
    const h = setup();
    h.runner.answer('topic_assignment', {
      assignments: [
        ...prs.slice(0, 7).map((pr, index) => ({ prKey: pr.key, kind: 'new', name: `Topic ${index}`, reason: 'new work' })),
        { prKey: prs[7]!.key, kind: 'unsorted', reason: 'fits nowhere' },
      ],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.topics.list()).toHaveLength(MAX_NEW_TOPICS_PER_SYNC);
    expect(h.store.memberships.listUnassignedPrKeys().sort()).toEqual([prs[5]!.key, prs[6]!.key, prs[7]!.key].sort());
    expect(h.store.meta.get(deferredKey(prs[7]!.key))).not.toBeNull();
  });

  it('offers member counts, and asks about deferred PRs again only after a consolidation', async () => {
    const h = setup();
    h.runner.answer('topic_assignment', {
      assignments: [
        ...prs.slice(0, 7).map((pr) => ({ prKey: pr.key, kind: 'new', name: 'Move CI to Depot', reason: 'same work' })),
        { prKey: prs[7]!.key, kind: 'unsorted', reason: 'fits nowhere' },
      ],
    });
    await h.engine.sync({ agentJobs: ['topics'] });

    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['topics'] });
    expect(h.runner.promptsFor('topic_assignment')).toHaveLength(1);

    h.store.cursors.advance({ kind: 'consolidate', scope: 'global', seq: 0, dossierVersion: null, updatedAt: '2030-01-01T00:00:00.000Z' });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: prs[7]!.key, kind: 'existing', topicId: h.store.topics.list()[0]!.id, reason: 'fits now' }] });
    h.reader.etag = 'etag-3';
    await h.engine.sync({ agentJobs: ['topics'] });

    const prompts = h.runner.promptsFor('topic_assignment');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('"Move CI to Depot" (7 PRs)');
    expect(h.store.memberships.listUnassignedPrKeys()).toEqual([]);
  });
});
