import { makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';

const prs = Array.from({ length: 12 }, (_, index) => reviewRequestedPr(index + 1));

function setup(count = prs.length) {
  const h = makeHarness();
  for (const pr of prs.slice(0, count)) {
    h.reader.addPr(pr, makeThreadFor(pr));
  }
  return h;
}

describe('topic assignment places every PR', () => {
  it('creates every new topic the agent names, without a cap', async () => {
    const h = setup();
    h.runner.answer('topic_assignment', {
      assignments: prs.map((pr, index) => ({ prKey: pr.key, kind: 'new', name: `Topic ${index}`, reason: 'new work' })),
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.topics.list()).toHaveLength(12);
    expect(h.store.memberships.listUnassignedPrKeys()).toEqual([]);
    expect(h.runner.promptsFor('topic_assignment')).toHaveLength(1);
  });

  it('asks once more, in the same sync, about PRs the answer left out or called unsorted', async () => {
    const h = setup(4);
    h.runner.answer('topic_assignment', {
      assignments: [
        { prKey: prs[0]!.key, kind: 'new', name: 'Move CI to Depot', reason: 'CI work' },
        { prKey: prs[1]!.key, kind: 'unsorted', reason: 'fits nowhere' },
        { prKey: prs[2]!.key, kind: 'existing', topicId: 'no-such-topic', reason: 'invalid' },
      ],
    });
    h.runner.answer('topic_assignment', {
      assignments: [prs[1]!, prs[2]!, prs[3]!].map((pr) => ({ prKey: pr.key, kind: 'new', name: 'move ci to depot', reason: 'same work' })),
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompts = h.runner.promptsFor('topic_assignment');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain(`${prs[0]!.key} "`);
    expect(prompts[1]).toMatch(/"Move CI to Depot" \(1 PR, 1 open, last activity \d{4}-\d{2}-\d{2}\)/);
    // The retry reuses the topic the first answer created (names match in any case).
    expect(h.store.topics.list().map((t) => t.name)).toEqual(['Move CI to Depot']);
    expect(h.store.memberships.listUnassignedPrKeys()).toEqual([]);
  });

  it('never parks a PR: one still missing after the retry is asked again next sync', async () => {
    const h = setup(2);
    h.runner.answer('topic_assignment', { assignments: [{ prKey: prs[0]!.key, kind: 'new', name: 'Billing', reason: 'billing' }] });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: prs[1]!.key, kind: 'unsorted', reason: 'fits nowhere' }] });

    const first = await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.listUnassignedPrKeys()).toEqual([prs[1]!.key]);
    expect(first.errors).toContain(`topic assignment: no topic after a retry, asked again next sync: ${prs[1]!.key}`);
    expect(h.store.meta.get(`topic_deferred:${prs[1]!.key}`)).toBeNull();

    h.runner.answer('topic_assignment', { assignments: [{ prKey: prs[1]!.key, kind: 'existing', topicId: h.store.topics.list()[0]!.id, reason: 'fits now' }] });
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_assignment')).toHaveLength(3);
    expect(h.store.memberships.listUnassignedPrKeys()).toEqual([]);
  });

  it('retries a failed call once and then leaves the PRs for the next sync', async () => {
    const h = setup(1);

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_assignment')).toHaveLength(2);
    expect(h.store.memberships.listUnassignedPrKeys()).toEqual([prs[0]!.key]);
    expect(report.errors.at(-1)).toBe(`topic assignment: no topic after a retry, asked again next sync: ${prs[0]!.key}`);
  });

  it('asks by repo, then by head branch, so related PRs share a request', async () => {
    const h = makeHarness();
    const mixed = [
      reviewRequestedPr(1, { repo: 'acme/web', headRef: 'alice/billing-2' }),
      reviewRequestedPr(2, { repo: 'acme/app', headRef: 'bob/storybook' }),
      reviewRequestedPr(3, { repo: 'acme/web', headRef: 'alice/billing-1' }),
    ];
    for (const pr of mixed) {
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    h.runner.answer('topic_assignment', { assignments: mixed.map((pr) => ({ prKey: pr.key, kind: 'new', name: 'Work', reason: 'work' })) });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompt = h.runner.promptsFor('topic_assignment')[0]!;
    const order = mixed.map((pr) => prompt.indexOf(`${pr.key} "`));
    expect(order[1]).toBeLessThan(order[2]!);
    expect(order[2]).toBeLessThan(order[0]!);
  });
});
