import { describe, expect, it } from 'vitest';
import type { NotificationDebugRow, NotificationLanding, NotificationThread } from '@code-manager/core';
import { filterNotifications, landingLabel, NO_NOTIFICATION_FILTER, noTileReason, reasonsIn, threadRef } from './notifications.ts';

function row(thread: Partial<NotificationThread>, landing: NotificationLanding = { kind: 'not_pr' }): NotificationDebugRow {
  return {
    thread: {
      id: thread.id ?? 't',
      reason: 'review_requested',
      unread: true,
      updatedAt: '2026-09-27T10:00:00Z',
      lastReadAt: null,
      subjectType: 'PullRequest',
      repo: 'PostHog/posthog',
      number: 1,
      title: 'Title',
      ...thread,
    },
    prKey: null,
    landing,
    recentEvents: [],
  };
}

const TILE: NotificationLanding = {
  kind: 'tile',
  topicId: 'topic-depot',
  topicName: 'Move CI to Depot',
  tileId: 'set:turbo',
  tileTitle: 'Turbo caches',
  tileState: 'unread',
  unsorted: false,
};

describe('notification debug helpers', () => {
  it('labels refs and landings', () => {
    expect(threadRef(row({ number: 12 }))).toBe('PostHog/posthog#12');
    expect(threadRef(row({ number: null, subjectType: 'Release' }))).toBe('PostHog/posthog');
    expect(landingLabel(TILE)).toBe('Move CI to Depot › Turbo caches');
    expect(landingLabel({ ...TILE, unsorted: true })).toBe('Unsorted › Turbo caches');
    expect(noTileReason(TILE)).toBeNull();
    expect(noTileReason({ kind: 'pr_not_synced' })).toContain('never fetched');
  });

  it('filters by reason, unread and text, keeping order', () => {
    const rows = [
      row({ id: 'a', reason: 'mention', title: 'Cache keys' }, TILE),
      row({ id: 'b', reason: 'subscribed', unread: false, title: 'Release notes' }),
      row({ id: 'c', reason: 'mention', unread: false, title: 'Other' }),
    ];
    expect(reasonsIn(rows)).toEqual(['mention', 'subscribed']);
    expect(filterNotifications(rows, NO_NOTIFICATION_FILTER).map((r) => r.thread.id)).toEqual(['a', 'b', 'c']);
    expect(filterNotifications(rows, { ...NO_NOTIFICATION_FILTER, reason: 'mention' }).map((r) => r.thread.id)).toEqual(['a', 'c']);
    expect(filterNotifications(rows, { ...NO_NOTIFICATION_FILTER, unreadOnly: true }).map((r) => r.thread.id)).toEqual(['a']);
    expect(filterNotifications(rows, { ...NO_NOTIFICATION_FILTER, text: 'depot cache' }).map((r) => r.thread.id)).toEqual(['a']);
  });
});
