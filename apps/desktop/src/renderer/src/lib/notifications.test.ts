import { describe, expect, it } from 'vitest';
import type { ActionLogEntry, NotificationDebugRow, NotificationLanding, NotificationThread } from '@postpile/core';
import { actionLine, filterNotifications, landingLabel, NO_NOTIFICATION_FILTER, noTileReason, reasonsIn, threadRef } from './notifications.ts';

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
    lastAction: null,
    decidedBy: null,
  };
}

function entry(overrides: Partial<ActionLogEntry>): ActionLogEntry {
  return {
    id: 1,
    at: '2026-09-27T10:00:00Z',
    action: 'mark_read',
    origin: 'tile',
    outcome: 'queued',
    threadId: 't',
    prKey: null,
    tileId: null,
    batch: 'b1',
    detail: '',
    ...overrides,
  };
}

const NOW = new Date('2026-09-27T10:03:00Z');

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

  it('says what led to a read state, from the action log', () => {
    const sent = entry({ id: 2, origin: 'queue', outcome: 'github' });
    expect(actionLine({ ...row({ unread: false }), lastAction: sent, decidedBy: entry({}) }, NOW)?.text).toBe(
      'marked read by the deferred queue, queued by you in a tile · 3m ago',
    );
    expect(actionLine({ ...row({}), lastAction: entry({ outcome: 'local', detail: 'GitHub writes are off' }) }, NOW)?.text).toBe(
      'stayed local: read-only · marked read by you in a tile · 3m ago',
    );
    expect(actionLine(row({ unread: false }), NOW)?.text).toBe('read on github.com or another client');
    expect(actionLine(row({ unread: true }), NOW)).toBeNull();
    const noticed = entry({ origin: 'sync', outcome: 'observed' });
    expect(actionLine({ ...row({ unread: false }), lastAction: noticed }, NOW)?.text).toMatch(/^read on github.com or another client · noticed by sync/);
  });

  it('filters to threads the app marked read, and to pending ones', () => {
    const rows = [
      { ...row({ id: 'a', unread: false }), lastAction: entry({ origin: 'queue', outcome: 'github' }) },
      { ...row({ id: 'b', unread: false }), lastAction: entry({ origin: 'sync', outcome: 'observed' }) },
      { ...row({ id: 'c' }), lastAction: entry({ outcome: 'pending', detail: 'GitHub writes are locked' }) },
      { ...row({ id: 'e' }), lastAction: entry({ outcome: 'queued', detail: 'GitHub writes are locked: becomes a pending write' }) },
      { ...row({ id: 'f' }), lastAction: entry({ outcome: 'queued' }) },
      row({ id: 'd', unread: false }),
    ];
    expect(filterNotifications(rows, { ...NO_NOTIFICATION_FILTER, readByApp: true }).map((r) => r.thread.id)).toEqual(['a', 'f']);
    expect(filterNotifications(rows, { ...NO_NOTIFICATION_FILTER, pendingOnly: true }).map((r) => r.thread.id)).toEqual(['c']);
  });

  it('labels pending, discarded and locked-queued mark-reads', () => {
    expect(actionLine({ ...row({}), lastAction: entry({ outcome: 'pending' }) }, NOW)).toMatchObject({ tone: 'pending' });
    expect(actionLine({ ...row({}), lastAction: entry({ outcome: 'pending' }) }, NOW)?.text).toMatch(/^pending while locked/);
    expect(actionLine({ ...row({}), lastAction: entry({ origin: 'footer', outcome: 'discarded' }) }, NOW)?.text).toMatch(/discarded: unread, like on GitHub/);
    expect(actionLine({ ...row({}), lastAction: entry({ outcome: 'queued', detail: 'locked' }) }, NOW)?.text).toMatch(/turns pending/);
  });
});
