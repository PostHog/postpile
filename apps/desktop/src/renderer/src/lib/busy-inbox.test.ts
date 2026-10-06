import { describe, expect, it } from 'vitest';
import type { BusyInboxView, InboxCleanupView } from '@postpile/core';
import { CLEANUP_PENDING_NOTE } from './cleanup.ts';
import { cleanUpBlocked, collapsedText, countText, keptTiers, leadParts, whyLines } from './busy-inbox.ts';

const busy: BusyInboxView = {
  busy: true,
  inboxPrs: 6140,
  keptPrs: 1500,
  quietPrs: 4640,
  cap: 1500,
  updatesLastHour: 300,
  keptYou: 940,
  keptTeam: 560,
  keptOthers: 0,
};

const cleanup: InboxCleanupView = {
  countedAt: '2026-10-05T09:00:00.000Z',
  counts: { unread: 210, mergedQuiet7: 31, mergedQuiet14: 0, mergedAll: 46, mergedWithoutReview: 9, mergedSafe: 8, olderThan14: 18, olderThan30: 6 },
  glances: 40,
  options: [],
  start: null,
  running: null,
  lastRun: null,
  pending: false,
  syncing: false,
};

describe('countText', () => {
  it('groups thousands with a comma', () => {
    expect(countText(4640)).toBe('4,640');
    expect(countText(12)).toBe('12');
  });
});

describe('leadParts', () => {
  it('keeps the quiet count apart for the mono number', () => {
    expect(leadParts(busy)).toEqual(['Focusing on what is aimed at you. ', { count: 4640 }, ' quiet PRs wait for news.']);
    expect(leadParts({ ...busy, quietPrs: 1 }).at(-1)).toBe(' quiet PR waits for news.');
  });
});

describe('keptTiers', () => {
  it('lists you, your team and others in board order', () => {
    expect(keptTiers(busy)).toEqual([
      { label: 'for you', count: 940 },
      { label: 'for your team', count: 560 },
      { label: 'for others', count: 0 },
    ]);
  });
});

describe('collapsedText', () => {
  it('names the quiet PRs', () => {
    expect(collapsedText(busy)).toBe('Busy inbox · 4,640 quiet PRs');
    expect(collapsedText({ ...busy, quietPrs: 1 })).toBe('Busy inbox · 1 quiet PR');
  });
});

describe('whyLines', () => {
  it('says what is kept, what waits and when it goes away', () => {
    const lines = whyLines(busy);
    expect(lines[0]).toBe('6,140 PRs are open, unread or active this week, 300 of them updated in the last hour. PostPile works on 1,500 at a time.');
    expect(lines).toContain("Other people's PRs wait, with no fetching and no agent work. Nothing is deleted.");
    expect(lines.at(-1)).toBe('This goes away by itself once your inbox is back under 1,500.');
  });

  it('never mentions the GitHub writes lock: that lives in the footer only', () => {
    expect(whyLines(busy).some((line) => /writes|lock/i.test(line))).toBe(false);
  });

  it('leaves out the updates line without updates', () => {
    const lines = whyLines({ ...busy, updatesLastHour: 0 });
    expect(lines.some((line) => line.includes('last hour'))).toBe(false);
  });
});

describe('cleanUpBlocked', () => {
  it('opens the dialog when there is something to clear', () => {
    expect(cleanUpBlocked(cleanup)).toBeNull();
  });

  it('waits for the counts, a running cleanup and one pending in the lock', () => {
    expect(cleanUpBlocked(undefined)).toMatch(/Counting/);
    expect(cleanUpBlocked({ ...cleanup, running: { done: 3, total: 40, merged: true } })).toMatch(/running/);
    expect(cleanUpBlocked({ ...cleanup, pending: true })).toBe(CLEANUP_PENDING_NOTE);
  });

  it('says when there is nothing to clean up', () => {
    const empty = { ...cleanup.counts, mergedAll: 0, olderThan14: 0 };
    expect(cleanUpBlocked({ ...cleanup, counts: empty })).toMatch(/Nothing to clean up/);
  });
});
