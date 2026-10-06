import type { Pr } from '@postpile/core';
import { at, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { makeTopic, topicWithPrs } from '../testing/topics.ts';
import { changeTopicStatus } from '../topic-status.ts';

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
    expect(prompts[1]).toMatch(/"Move CI to Depot" \(project, 1 PR, 1 open, last activity \d{4}-\d{2}-\d{2}\)/);
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

  it('asks by author, then oldest first, so the project of one person shares a request', async () => {
    const h = makeHarness();
    const mixed = [
      reviewRequestedPr(1, { repo: 'acme/web', author: 'alice', createdAt: at(3) }),
      reviewRequestedPr(2, { repo: 'acme/app', author: 'bob', createdAt: at(1) }),
      reviewRequestedPr(3, { repo: 'acme/app', author: 'alice', createdAt: at(2) }),
    ];
    for (const pr of mixed) {
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    h.runner.answer('topic_assignment', { assignments: mixed.map((pr) => ({ prKey: pr.key, kind: 'new', name: 'Work', reason: 'work' })) });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompt = h.runner.promptsFor('topic_assignment')[0]!;
    const order = mixed.map((pr) => prompt.indexOf(`${pr.key} "`));
    expect(order[2]).toBeLessThan(order[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
  });

  it('keeps the goal of a new topic as its summary, so the next batch sees what it is for', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'new', name: 'Desktop review app', goal: 'Ship the desktop app that sorts PR notifications.', reason: 'app work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    const topicId = h.store.memberships.get(pr.key)!.topicId;
    expect(h.store.topics.get(topicId)?.summary).toBe('Ship the desktop app that sorts PR notifications.');
  });
});

/** The PRs sit in the topic as the agent placed them. */
function placedByAgent(h: Harness, topicId: string, placed: Pr[]): void {
  topicWithPrs(h, topicId, placed);
  for (const pr of placed) {
    h.store.memberships.assign({ prKey: pr.key, topicId, assignedBy: 'agent', reason: '', createdAt: at(0) });
  }
}

/** A "Wrong topic" logged before this run, the way the action logs it. */
function tookOut(h: Harness, pr: Pr, topicId: string): void {
  h.store.feedback.add({ kind: 'wrong_topic', topicId, prKey: pr.key, tileId: `pr:${pr.key}`, setId: null, eventId: null, note: '', createdAt: at(1) });
}

describe('"Wrong topic" keeps a PR out of the topic it left', () => {
  const pr = reviewRequestedPr(1);

  /** pr sat in billing; the user said "Wrong topic" without picking where it goes. */
  async function takenOutOfBilling(): Promise<Harness> {
    const h = makeHarness();
    placedByAgent(h, 'billing', [pr]);
    h.store.topics.create(makeTopic('payments'));
    await h.engine.sync({ maxAgentCalls: 0 });
    const result = await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: `pr:${pr.key}`, prKey: pr.key, targetTopicId: null, note: '' });
    expect(result.ok).toBe(true);
    expect(h.store.memberships.get(pr.key)).toBeNull();
    return h;
  }

  it('tells the agent, and asks again when the answer puts it back', async () => {
    const h = await takenOutOfBilling();
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'existing', topicId: 'billing', reason: 'billing work' }] });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'existing', topicId: 'payments', reason: 'payments work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompts = h.runner.promptsFor('topic_assignment');
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('out of these topics. Never put it back there, also not as a new topic of the same name:\n<github_data>\n- id billing: "billing"\n</github_data>');
    expect(h.store.memberships.get(pr.key)).toMatchObject({ topicId: 'payments', assignedBy: 'agent' });
  });

  it('drops a new topic named like the one it left, and leaves the PR in Unsorted after the retry', async () => {
    const h = await takenOutOfBilling();
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'new', name: 'Billing', goal: 'Bill people.', reason: 'billing work' }] });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'existing', topicId: 'billing', reason: 'billing work' }] });

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(pr.key)).toBeNull();
    expect(report.errors).toContain(`topic assignment: no topic after a retry, asked again next sync: ${pr.key}`);
    expect(h.store.topics.list().map((topic) => topic.id).sort()).toEqual(['billing', 'payments']);
  });

  it('drops a new topic named like the one it left when that one is no longer offered', async () => {
    const h = await takenOutOfBilling();
    changeTopicStatus(h.store, 'billing', 'archive', at(2));
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'new', name: 'BILLING', goal: 'Bill people.', reason: 'billing work' }] });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'new', name: 'Login flow', goal: 'Fix logins.', reason: 'its own work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompt = h.runner.promptsFor('topic_assignment')[0]!;
    expect(prompt).not.toContain('- id billing: "billing" (');
    expect(prompt).toContain('- id billing: "billing"\n</github_data>');
    expect(h.store.topics.list().filter((topic) => topic.name.toLowerCase() === 'billing')).toHaveLength(1);
    expect(h.store.topics.get(h.store.memberships.get(pr.key)?.topicId ?? '')?.name).toBe('Login flow');
  });

  it('keeps it out of the topic the one it left was merged into', async () => {
    const h = await takenOutOfBilling();
    h.store.proposals.add({
      id: 'm1',
      kind: 'merge',
      topicId: 'billing',
      name: null,
      intoTopicId: 'payments',
      fromArea: null,
      prKeys: [],
      reason: 'same invoices work',
      status: 'pending',
      createdAt: at(2),
      decidedAt: null,
      source: 'consolidation',
      client: null,
    });
    expect((await h.engine.decideTopicProposal('m1', true)).ok).toBe(true);
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'existing', topicId: 'payments', reason: 'payments work' }] });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'new', name: 'Login flow', goal: 'Fix logins.', reason: 'its own work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_assignment')[0]).toContain('- id payments: "payments"\n</github_data>');
    const topicId = h.store.memberships.get(pr.key)?.topicId;
    expect(h.store.topics.get(topicId ?? '')?.name).toBe('Login flow');
  });

  it('goes back when the user picks that topic, and stays there', async () => {
    const h = await takenOutOfBilling();

    const result = await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: `pr:${pr.key}`, prKey: pr.key, targetTopicId: 'billing', note: '' });
    await h.engine.sync({ agentJobs: ['topics'] });

    expect(result.ok).toBe(true);
    expect(h.runner.promptsFor('topic_assignment')).toEqual([]);
    expect(h.store.memberships.get(pr.key)).toMatchObject({ topicId: 'billing', assignedBy: 'user' });
  });

  it('keeps a topic the user picked while the agent call ran', async () => {
    const h = await takenOutOfBilling();
    const run = h.runner.run.bind(h.runner);
    h.runner.run = async (request) => {
      if (request.purpose === 'topic_assignment') {
        await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: `pr:${pr.key}`, prKey: pr.key, targetTopicId: 'billing', note: '' });
      }
      return run(request);
    };
    h.runner.answer('topic_assignment', { assignments: [{ prKey: pr.key, kind: 'existing', topicId: 'payments', reason: 'payments work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(pr.key)).toMatchObject({ topicId: 'billing', assignedBy: 'user' });
  });

  it('does not join a stack whose topic it was taken out of: the agent places it', async () => {
    const h = makeHarness();
    const bottom = reviewRequestedPr(1, { baseRef: 'master', headRef: 's1' });
    const top = reviewRequestedPr(2, { baseRef: 's1', headRef: 's2' });
    placedByAgent(h, 'depot', [bottom]);
    h.store.topics.create(makeTopic('billing'));
    h.reader.addPr(top, makeThreadFor(top));
    // The stack formed after the user took the top PR out of depot.
    tookOut(h, top, 'depot');
    h.runner.answer('topic_assignment', { assignments: [{ prKey: top.key, kind: 'existing', topicId: 'billing', reason: 'billing work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompts = h.runner.promptsFor('topic_assignment');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('- id depot: "depot"\n</github_data>');
    expect(h.store.memberships.get(top.key)).toMatchObject({ topicId: 'billing', assignedBy: 'agent' });
  });

  it('keeps every layer of a stack out, and asks about the stack as one', async () => {
    const h = makeHarness();
    const bottom = reviewRequestedPr(1, { baseRef: 'master', headRef: 's1' });
    const middle = reviewRequestedPr(2, { baseRef: 's1', headRef: 's2' });
    const top = makePr({ number: 3, baseRef: 's2', headRef: 's3', isDraft: true });
    placedByAgent(h, 'depot', [bottom, middle]);
    h.reader.addStackPr(top);
    await h.engine.sync({ maxAgentCalls: 0 });

    await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: `stack:${bottom.key}`, prKey: middle.key, targetTopicId: null, note: '' });

    expect(h.store.feedback.listAllOfKind('wrong_topic').map((row) => [row.prKey, row.topicId])).toEqual([
      [bottom.key, 'depot'],
      [middle.key, 'depot'],
    ]);
    h.runner.answer('topic_assignment', { assignments: [{ prKey: bottom.key, kind: 'existing', topicId: 'depot', reason: 'runner work' }] });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: bottom.key, kind: 'new', name: 'Billing', goal: 'Bill people.', reason: 'billing work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompts = h.runner.promptsFor('topic_assignment');
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('- id depot: "depot"\n</github_data>');
    expect(prompts[0]).not.toContain(`${middle.key} "`);
    const billing = h.store.memberships.get(bottom.key)?.topicId;
    expect(billing).not.toBe('depot');
    expect(h.store.memberships.get(middle.key)?.topicId).toBe(billing);
  });
});
