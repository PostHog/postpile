import type { Pr } from '@postpile/core';
import { at, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { topicWithPrs } from '../testing/topics.ts';
import { changeTopicStatus } from '../topic-status.ts';
import { saveViewer } from '../viewer-meta.ts';
import { TOPIC_GRAIN_KEY, TOPIC_GRAIN_VERSION } from './topic-tidy.ts';

// The topic tidy runs once after an upgrade that changed how topics are cut
// (DESIGN.md "Topic tidy after an upgrade"): merges and splits applied
// without asking, recorded as accepted proposals from the upgrade.

/** topicWithPrs places PRs as the user would; a tidy mostly meets the agent's placements. */
function placedByAgent(h: ReturnType<typeof makeHarness>, topicId: string, prs: Pr[]): void {
  topicWithPrs(h, topicId, prs);
  for (const pr of prs) {
    h.store.memberships.assign({ prKey: pr.key, topicId, assignedBy: 'agent', reason: '', createdAt: at(0) });
  }
}

function tidyHarness() {
  const h = makeHarness({ topicTidyDue: true });
  const prs = [1, 2, 3, 4].map((n) => reviewRequestedPr(n));
  placedByAgent(h, 'review-app-polling', [prs[0]!]);
  placedByAgent(h, 'review-app-packaging', [prs[1]!]);
  placedByAgent(h, 'repo-conventions', [prs[2]!, prs[3]!]);
  return { h, prs };
}

describe('topic tidy after an upgrade', () => {
  it('merges topics of one project and records it as an accepted change from the upgrade', async () => {
    const { h, prs } = tidyHarness();
    h.runner.answer('topic_tidy', {
      merges: [{ fromTopicIds: ['review-app-packaging'], intoTopicId: 'review-app-polling', name: 'Desktop review app', reason: 'one app, two steps' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[1]!.key)?.topicId).toBe('review-app-polling');
    expect(h.store.topics.get('review-app-polling')?.name).toBe('Desktop review app');
    expect(h.store.topics.get('review-app-packaging')?.status).toBe('archived');
    const [recorded] = h.store.proposals.listForTopic('review-app-packaging');
    expect(recorded).toMatchObject({ kind: 'merge', intoTopicId: 'review-app-polling', status: 'accepted', source: 'upgrade' });
    expect(h.store.meta.get(TOPIC_GRAIN_KEY)).toBe(String(TOPIC_GRAIN_VERSION));
  });

  it('runs once: the next sync makes no tidy call', async () => {
    const { h } = tidyHarness();
    h.runner.answer('topic_tidy', {});
    await h.engine.sync({ agentJobs: ['topics'] });

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(report.agentCallStats.byKind.topic_tidy).toBeUndefined();
  });

  it('times the tidy as its own sync phase, so the app can cover the window', async () => {
    const { h } = tidyHarness();
    h.runner.answer('topic_tidy', {});

    const first = await h.engine.sync({ agentJobs: ['topics'] });
    const second = await h.engine.sync({ agentJobs: ['topics'] });

    expect(first.phaseMs?.tidy).toBeDefined();
    expect(second.phaseMs?.tidy).toBeUndefined();
  });

  it('moves split PRs where the answer says, a new topic or an existing one', async () => {
    const { h, prs } = tidyHarness();
    h.runner.answer('topic_tidy', {
      splits: [
        { topicId: 'repo-conventions', prKeys: [prs[3]!.key], intoTopicId: null, newName: 'Billing rewrite', reason: 'not about conventions' },
      ],
    });

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    const topicId = h.store.memberships.get(prs[3]!.key)?.topicId;
    expect(h.store.topics.get(topicId!)?.name).toBe('Billing rewrite');
    expect(h.store.memberships.get(prs[2]!.key)?.topicId).toBe('repo-conventions');
    // Placed by the tidy itself: the assignment has nothing left to place.
    expect(report.agentCallStats.byKind.topic_assignment).toBeUndefined();
  });

  it('moves split PRs into an existing topic the answer names', async () => {
    const { h, prs } = tidyHarness();
    h.runner.answer('topic_tidy', {
      splits: [{ topicId: 'repo-conventions', prKeys: [prs[3]!.key], intoTopicId: 'review-app-polling', newName: null, reason: 'part of the app' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[3]!.key)?.topicId).toBe('review-app-polling');
  });

  it('tries again on the next sync when the call fails', async () => {
    const { h } = tidyHarness();
    h.runner.answer('topic_tidy', 'not json');

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(report.errors.some((line) => line.startsWith('topic tidy'))).toBe(true);
    expect(h.store.meta.get(TOPIC_GRAIN_KEY)).toBeNull();
  });

  it('marks a store without topics done without a call', async () => {
    const h = makeHarness({ topicTidyDue: true });

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(report.agentCallStats.byKind.topic_tidy).toBeUndefined();
    expect(h.store.meta.get(TOPIC_GRAIN_KEY)).toBe(String(TOPIC_GRAIN_VERSION));
  });

  it('tidies a store whose only topic is a catch-all', async () => {
    const h = makeHarness({ topicTidyDue: true });
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    placedByAgent(h, 'everything', prs);
    h.runner.answer('topic_tidy', { splits: [{ topicId: 'everything', prKeys: [prs[1]!.key], intoTopicId: null, newName: 'Billing rewrite', reason: 'unrelated' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[1]!.key)?.topicId).not.toBe('everything');
  });

  it('never folds away a topic that holds a PR the user placed', async () => {
    const { h, prs } = tidyHarness();
    h.store.memberships.assign({ prKey: prs[1]!.key, topicId: 'review-app-packaging', assignedBy: 'user', reason: 'mine', createdAt: at(1) });
    h.runner.answer('topic_tidy', {
      merges: [{ fromTopicIds: ['review-app-packaging'], intoTopicId: 'review-app-polling', name: null, reason: 'one app' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[1]!.key)).toMatchObject({ topicId: 'review-app-packaging', assignedBy: 'user' });
    expect(h.store.topics.get('review-app-packaging')?.status).toBe('active');
  });

  it('leaves a PR the user placed where they put it', async () => {
    const { h, prs } = tidyHarness();
    h.store.memberships.assign({ prKey: prs[3]!.key, topicId: 'repo-conventions', assignedBy: 'user', reason: 'I put it here', createdAt: at(1) });
    h.runner.answer('topic_tidy', {
      splits: [{ topicId: 'repo-conventions', prKeys: [prs[3]!.key], intoTopicId: null, newName: 'Billing rewrite', reason: 'not about conventions' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[3]!.key)).toMatchObject({ topicId: 'repo-conventions', assignedBy: 'user' });
  });

  it('never empties a topic, also when a split layer brings its whole stack', async () => {
    const h = makeHarness({ topicTidyDue: true });
    const bottom = reviewRequestedPr(1, { baseRef: 'master', headRef: 's1' });
    const top = reviewRequestedPr(2, { baseRef: 's1', headRef: 's2' });
    placedByAgent(h, 'stack-topic', [bottom, top]);
    placedByAgent(h, 'other', [reviewRequestedPr(3)]);
    h.runner.answer('topic_tidy', { splits: [{ topicId: 'stack-topic', prKeys: [top.key], intoTopicId: null, newName: 'Elsewhere', reason: 'stray' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(bottom.key)?.topicId).toBe('stack-topic');
    expect(h.store.memberships.get(top.key)?.topicId).toBe('stack-topic');
  });

  it('sorts topics into kinds and renames one named after a step, recording the rename', async () => {
    const { h } = tidyHarness();
    h.runner.answer('topic_tidy', {
      renames: [{ topicId: 'repo-conventions', name: 'Migration safety', reason: 'it holds the whole standard' }],
      kinds: [{ topicId: 'repo-conventions', kind: 'standing' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.topics.get('repo-conventions')).toMatchObject({ name: 'Migration safety', kind: 'standing' });
    expect(h.store.topics.get('review-app-polling')?.kind).toBe('project');
    const [recorded] = h.store.proposals.listForTopic('repo-conventions');
    expect(recorded).toMatchObject({ kind: 'rename', name: 'Migration safety', status: 'accepted', source: 'upgrade' });
  });

  it('shows the agent topics in the Archive and brings one back when PRs join it', async () => {
    const { h, prs } = tidyHarness();
    changeTopicStatus(h.store, 'review-app-packaging', 'retire', at(1));
    h.runner.answer('topic_tidy', {
      merges: [{ fromTopicIds: ['review-app-polling'], intoTopicId: 'review-app-packaging', name: 'Desktop review app', reason: 'one app' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_tidy')[0]).toContain('topic id review-app-packaging: "review-app-packaging" (project, 1 PR, in the Archive)');
    expect(h.store.memberships.get(prs[0]!.key)?.topicId).toBe('review-app-packaging');
    expect(h.store.topics.get('review-app-packaging')?.status).toBe('active');
  });

  it('gives a new topic from a split the kind the answer names', async () => {
    const { h, prs } = tidyHarness();
    h.runner.answer('topic_tidy', {
      splits: [{ topicId: 'repo-conventions', prKeys: [prs[3]!.key], intoTopicId: null, newName: 'Code ownership', newKind: 'standing', reason: 'a standard' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    const topicId = h.store.memberships.get(prs[3]!.key)?.topicId;
    expect(h.store.topics.get(topicId!)).toMatchObject({ name: 'Code ownership', kind: 'standing' });
  });

  it('runs first in a full sync, before the GitHub fetch, so the cover goes up at once', async () => {
    const { h } = tidyHarness();
    saveViewer(h.store, viewer);
    const fetchesAtTidy: number[] = [];
    const run = h.runner.run.bind(h.runner);
    h.runner.run = (request) => {
      if (request.purpose === 'topic_tidy') {
        fetchesAtTidy.push(h.reader.notificationCalls);
      }
      return run(request);
    };
    h.runner.answer('topic_tidy', {});

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(fetchesAtTidy).toEqual([0]);
  });

  it('tries once per sync: a failed call before the fetch is not repeated by the digest', async () => {
    const { h } = tidyHarness();
    saveViewer(h.store, viewer);
    h.runner.answer('topic_tidy', 'not json');

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_tidy')).toHaveLength(1);
    expect(report.errors.some((line) => line.startsWith('topic tidy'))).toBe(true);
    expect(h.store.meta.get(TOPIC_GRAIN_KEY)).toBeNull();
  });

  it('shows the agent a topic archived long ago that would still be on offer as a standing topic', async () => {
    const day = 24 * 60;
    const h = makeHarness({ topicTidyDue: true, now: () => new Date(at(70 * day)) });
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    placedByAgent(h, 'migration-safety', [prs[0]!]);
    placedByAgent(h, 'other', [prs[1]!]);
    changeTopicStatus(h.store, 'migration-safety', 'retire', at(10 * day));
    h.runner.answer('topic_tidy', { kinds: [{ topicId: 'migration-safety', kind: 'standing' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_tidy')[0]).toContain('topic id migration-safety:');
    expect(h.store.topics.get('migration-safety')?.kind).toBe('standing');
  });
});

describe('topic tidy keeps "Wrong topic"', () => {
  /** A "Wrong topic" the user gave before the tidy: the PR was in topicId and left it. */
  function tookOut(h: ReturnType<typeof makeHarness>, pr: Pr, topicId: string): void {
    h.store.feedback.add({ kind: 'wrong_topic', topicId, prKey: pr.key, tileId: `pr:${pr.key}`, setId: null, eventId: null, note: '', createdAt: at(1) });
  }

  it('never folds a topic into one the user took a PR of it out of', async () => {
    const { h, prs } = tidyHarness();
    tookOut(h, prs[1]!, 'review-app-polling');
    h.runner.answer('topic_tidy', {
      merges: [{ fromTopicIds: ['review-app-packaging'], intoTopicId: 'review-app-polling', name: 'Desktop review app', reason: 'one app' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[1]!.key)?.topicId).toBe('review-app-packaging');
    expect(h.store.topics.get('review-app-packaging')?.status).toBe('active');
    expect(h.store.topics.get('review-app-polling')?.name).toBe('review-app-polling');
  });

  it('never folds the work a PR was taken out of into the topic that holds it now, also after an earlier fold', async () => {
    const { h, prs } = tidyHarness();
    tookOut(h, prs[1]!, 'repo-conventions');
    h.runner.answer('topic_tidy', {
      merges: [{ fromTopicIds: ['review-app-packaging', 'repo-conventions'], intoTopicId: 'review-app-polling', name: null, reason: 'one app' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[1]!.key)?.topicId).toBe('review-app-polling');
    expect(h.store.memberships.get(prs[2]!.key)?.topicId).toBe('repo-conventions');
    expect(h.store.topics.get('repo-conventions')?.status).toBe('active');
  });

  it('never splits a PR into a topic the user took it out of', async () => {
    const { h, prs } = tidyHarness();
    tookOut(h, prs[3]!, 'review-app-polling');
    h.runner.answer('topic_tidy', {
      splits: [{ topicId: 'repo-conventions', prKeys: [prs[3]!.key], intoTopicId: 'review-app-polling', newName: null, reason: 'app work' }],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(prs[3]!.key)?.topicId).toBe('repo-conventions');
  });
});
