import { makeThreadFor, viewer } from '@code-manager/core/fixtures';
import type { NotificationThread } from '@code-manager/core';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

function storedThread(overrides: Partial<NotificationThread>): NotificationThread {
  return {
    id: 'extra',
    reason: 'subscribed',
    unread: true,
    updatedAt: '2030-01-01T00:00:00.000Z',
    lastReadAt: null,
    subjectType: 'Issue',
    repo: 'PostHog/posthog',
    number: 900,
    title: 'An issue',
    ...overrides,
  };
}

describe('Engine.debugNotifications', () => {
  it('lists stored threads newest first with where each landed, without writing to GitHub', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.notifications.upsertMany([
      storedThread({ id: 'issue', updatedAt: '2030-01-02T00:00:00.000Z' }),
      storedThread({ id: 'unsynced', subjectType: 'PullRequest', number: 901, title: 'Never fetched' }),
    ]);

    const rows = await h.engine.debugNotifications(10);

    expect(rows.map((row) => row.thread.id)).toEqual(['issue', 'unsynced', makeThreadFor(pr).id]);
    expect(rows[0]).toMatchObject({ prKey: null, landing: { kind: 'not_pr' }, recentEvents: [] });
    expect(rows[1]).toMatchObject({ prKey: 'PostHog/posthog#901', landing: { kind: 'pr_not_synced' } });
    expect(rows[2]).toMatchObject({
      prKey: pr.key,
      landing: { kind: 'tile', topicId: UNSORTED_TOPIC_ID, unsorted: true, tileState: 'unread' },
    });
    expect(rows[2]?.recentEvents[0]?.kind).toBe('review_requested');
    expect(rows[2]?.thread.unread).toBe(true);
    expect(h.writer.calls).toEqual([]);
  });

  it('stops at the limit', async () => {
    const h = makeHarness();
    h.store.notifications.upsertMany([storedThread({ id: 'a' }), storedThread({ id: 'b' })]);
    expect(await h.engine.debugNotifications(1)).toHaveLength(1);
  });
});
