// Words for the inbox catch-up (DESIGN.md "Inbox cleanup"): the sidebar
// line, the dialog's title, lead and notes, the timing and saving lines, the
// footer progress and the done toast. The rules (counts, cases, plan) are in
// core; this only words what the server sent.
import {
  CATCH_UP_PACE_MS,
  type CleanupCounts,
  type CleanupDialogMode,
  type CleanupOption,
  type CleanupProgress,
  type CleanupRunResult,
  type InboxCleanupView,
  type MergedPick,
} from '@postpile/core';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The sidebar footer line: a running cleanup's progress, else the unread
 * merged PRs, else old notifications. Null when there is nothing to clear.
 * (A second item, merged PRs whose glance found nothing worth a look, may join later.)
 */
export type CleanupLine = { kind: 'running'; text: string } | { kind: 'merged'; text: string } | { kind: 'old'; text: string };

export function cleanupLine(view: InboxCleanupView): CleanupLine | null {
  if (view.running) {
    return { kind: 'running', text: `Clearing ${view.running.done} / ${view.running.total}` };
  }
  if (view.counts.mergedAll > 0) {
    return { kind: 'merged', text: plural(view.counts.mergedAll, 'merged PR', 'merged PRs') };
  }
  if (view.counts.olderThan14 > 0) {
    return { kind: 'old', text: plural(view.counts.olderThan14, 'old notification', 'old notifications') };
  }
  return null;
}

export function dialogTitle(mode: CleanupDialogMode): string {
  switch (mode.kind) {
    case 'weekend':
    case 'vacation':
      return 'Welcome back';
    case 'first_run':
      return 'Before the first sync';
    case 'sidebar':
      return 'Clean up your inbox';
  }
}

/** Text with the numbers apart, so they can be set in bold mono. */
export type LeadPart = string | { count: number };

/** "Friday" from the last sync, in the viewer's locale. */
function weekday(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
}

export function dialogLead(mode: CleanupDialogMode, counts: CleanupCounts): LeadPart[] {
  const merged = { count: counts.mergedAll };
  switch (mode.kind) {
    case 'weekend':
      return [`Since ${weekday(mode.since)}, merged PRs you didn't catch up on grew to `, merged, '.'];
    case 'vacation':
      return [`You were away ${mode.awayDays} days. Merged PRs you didn't catch up on grew to `, merged, '.'];
    case 'first_run':
      return ['Your GitHub inbox has ', { count: counts.unread }, ' unread threads, ', merged, ' of them on merged PRs.'];
    case 'sidebar':
      return ["Merged PRs you didn't catch up on: ", merged, '. Older notifications: ', { count: counts.olderThan14 }, '.'];
  }
}

export const MERGED_PICK_LABELS: Record<MergedPick, string> = {
  quiet7: 'Quiet 7+ days',
  quiet14: 'Quiet 14+ days',
  all: 'All',
};

export function mergedCount(pick: MergedPick, counts: CleanupCounts): number {
  if (pick === 'quiet7') {
    return counts.mergedQuiet7;
  }
  return pick === 'quiet14' ? counts.mergedQuiet14 : counts.mergedAll;
}

/** Why a merged option is disabled; null when it can be picked. */
export function mergedPickBlocked(pick: MergedPick, counts: CleanupCounts): string | null {
  if (pick === 'all') {
    return null;
  }
  const count = mergedCount(pick, counts);
  if (count === 0) {
    return 'None this quiet';
  }
  return count === counts.mergedAll ? 'Same as All' : null;
}

export function mergedNote(pick: MergedPick, counts: CleanupCounts): string {
  if (pick !== 'all') {
    return 'Leaves the ones still getting comments';
  }
  return counts.mergedWithoutReview > 0 ? `Includes ${counts.mergedWithoutReview} merged without your review` : '';
}

export function timingText(option: CleanupOption | null, locked: boolean, sidebar: boolean): string {
  if (locked) {
    return 'GitHub writes are locked: this waits as one pending write until you unlock and send it.';
  }
  if (option === null || option.clears === 0) {
    return sidebar ? 'Pick something to clear.' : 'Pick something to clear, or start as usual.';
  }
  if (option.threadCalls === 0) {
    const calls = option.bulkCalls === 1 ? 'One call' : `${option.bulkCalls} calls`;
    return `${calls} to GitHub. The tiles follow on the next poll.`;
  }
  const minutes = Math.max(1, Math.round((option.threadCalls * CATCH_UP_PACE_MS) / 60_000));
  return `Runs in the background, about ${plural(minutes, 'minute', 'minutes')}. You can keep working.`;
}

/** The green line: how many PRs the agent reads with these picks, against without. Null when they save nothing. */
export function savingCounts(view: InboxCleanupView, option: CleanupOption | null): { after: number; before: number } | null {
  if (option === null || option.glancesSaved === 0 || view.glances === 0) {
    return null;
  }
  return { after: view.glances - option.glancesSaved, before: view.glances };
}

export function progressLabel(progress: CleanupProgress): string {
  return progress.merged ? 'Clearing merged PRs' : 'Clearing old notifications';
}

export function doneText(run: CleanupRunResult): string {
  const failed = run.failed > 0 ? `, ${run.failed} failed` : '';
  return `Marked ${run.marked} read on GitHub${failed}`;
}
