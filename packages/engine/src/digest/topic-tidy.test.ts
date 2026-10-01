import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { topicWithPrs } from '../testing/topics.ts';
import { TOPIC_GRAIN_KEY, TOPIC_GRAIN_VERSION } from './topic-tidy.ts';

// The topic tidy runs once after an upgrade that changed how topics are cut
// (DESIGN.md "Topic tidy after an upgrade"): merges and splits applied
// without asking, recorded as accepted proposals from the upgrade.

function tidyHarness() {
  const h = makeHarness({ topicTidyDue: true });
  const prs = [1, 2, 3, 4].map((n) => reviewRequestedPr(n));
  topicWithPrs(h, 'review-app-polling', [prs[0]!]);
  topicWithPrs(h, 'review-app-packaging', [prs[1]!]);
  topicWithPrs(h, 'repo-conventions', [prs[2]!, prs[3]!]);
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

  it('takes split PRs out, and the topic assignment places them in the same sync', async () => {
    const { h, prs } = tidyHarness();
    h.runner.answer('topic_tidy', { splits: [{ topicId: 'repo-conventions', prKeys: [prs[3]!.key], reason: 'not about conventions' }] });
    h.runner.answer('topic_assignment', { assignments: [{ prKey: prs[3]!.key, kind: 'new', name: 'Billing rewrite', goal: 'Rewrite billing.', reason: 'billing work' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    const topicId = h.store.memberships.get(prs[3]!.key)?.topicId;
    expect(h.store.topics.get(topicId!)?.name).toBe('Billing rewrite');
    expect(h.store.memberships.get(prs[2]!.key)?.topicId).toBe('repo-conventions');
  });

  it('tries again on the next sync when the call fails', async () => {
    const { h } = tidyHarness();
    h.runner.answer('topic_tidy', 'not json');

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(report.errors.some((line) => line.startsWith('topic tidy'))).toBe(true);
    expect(h.store.meta.get(TOPIC_GRAIN_KEY)).toBeNull();
  });

  it('marks a store with fewer than two topics done without a call', async () => {
    const h = makeHarness({ topicTidyDue: true });
    topicWithPrs(h, 'only', [reviewRequestedPr(1)]);

    const report = await h.engine.sync({ agentJobs: ['topics'] });

    expect(report.agentCallStats.byKind.topic_tidy).toBeUndefined();
    expect(h.store.meta.get(TOPIC_GRAIN_KEY)).toBe(String(TOPIC_GRAIN_VERSION));
  });
});
