import { describe, expect, it } from 'vitest';
import type { CleanupOption, InboxCleanupView } from '@postpile/core';
import { cleanupLine, dialogLead, mergedNote, safeMergedText, savingCounts, timingText } from './cleanup.ts';

const option: CleanupOption = { merged: 'all', older: null, clears: 46, bulkCalls: 1, threadCalls: 150, glancesSaved: 9 };

const view: InboxCleanupView = {
  countedAt: '2026-09-28T12:00:00.000Z',
  counts: { unread: 210, mergedQuiet7: 31, mergedQuiet14: 0, mergedAll: 46, mergedWithoutReview: 9, mergedSafe: 8, olderThan14: 18, olderThan30: 6 },
  glances: 40,
  options: [option],
  start: null,
  running: null,
  lastRun: null,
  pending: false,
  syncing: false,
};

describe('inbox cleanup words', () => {
  it('shows progress, then merged PRs, then old notifications in the sidebar line', () => {
    expect(cleanupLine({ ...view, running: { done: 84, total: 191, merged: true } })).toEqual({ kind: 'running', text: 'Clearing 84 / 191' });
    expect(cleanupLine(view)).toEqual({ kind: 'merged', text: '46 merged PRs' });
    expect(cleanupLine({ ...view, counts: { ...view.counts, mergedAll: 0 } })).toEqual({ kind: 'old', text: '18 old notifications' });
    expect(cleanupLine({ ...view, counts: { ...view.counts, mergedAll: 0, olderThan14: 0 } })).toBeNull();
  });

  it('adds the look-safe item only when the agent called some merged PRs fine and no run goes', () => {
    expect(safeMergedText(view)).toBe('8 of them look safe');
    expect(safeMergedText({ ...view, counts: { ...view.counts, mergedSafe: 1 } })).toBe('1 of them looks safe');
    expect(safeMergedText({ ...view, counts: { ...view.counts, mergedSafe: 0 } })).toBeNull();
    expect(safeMergedText({ ...view, running: { done: 2, total: 8, merged: true } })).toBeNull();
  });

  it('words the lead per case with the numbers apart', () => {
    expect(dialogLead({ kind: 'vacation', since: '2026-09-16T12:00:00.000Z', awayDays: 12 }, view.counts)).toEqual([
      "You were away 12 days. Merged PRs you didn't catch up on grew to ",
      { count: 46 },
      '.',
    ]);
    expect(dialogLead({ kind: 'first_run', load: 'busy' }, view.counts)).toEqual(['Your GitHub inbox has ', { count: 210 }, ' unread threads, ', { count: 46 }, ' of them on merged PRs.']);
  });

  it('says how long it takes, what it leaves and what it saves', () => {
    expect(timingText(option, false, false)).toBe('Runs in the background, about 3 minutes. You can keep working.');
    expect(timingText({ ...option, threadCalls: 0 }, false, false)).toBe('One call to GitHub. The tiles follow on the next poll.');
    expect(timingText(option, true, false)).toBe('GitHub writes are locked: this waits as one pending write until you unlock and send it.');
    expect(mergedNote('all', view.counts)).toBe('Includes 9 merged without your review');
    expect(mergedNote('quiet7', view.counts)).toBe('Leaves the ones still getting comments');
    expect(savingCounts(view, option)).toEqual({ after: 31, before: 40 });
    expect(savingCounts(view, { ...option, glancesSaved: 0 })).toBeNull();
  });
});
