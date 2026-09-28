import type { GitHubWritesStatus } from '@postpile/core';

/** Actions that end up as a GitHub write, now or after the undo window. */
export type GithubWrite = 'approve' | 'comment' | 'markRead' | 'notMine';

const WHAT: Record<GithubWrite, string> = {
  approve: 'Approving',
  comment: 'Sending a comment',
  markRead: 'Marking read',
  notMine: '"Not mine"',
};

/**
 * Mark-reads still make sense with GitHub writes off: they change the app and
 * the GitHub notification stays unread. Approve and comment do nothing but
 * write to GitHub, so they are blocked while the lock is closed.
 */
const LOCAL_WHEN_OFF: Record<GithubWrite, boolean> = {
  approve: false,
  comment: false,
  markRead: true,
  notMine: true,
};

/** How to open the lock, or why it cannot be opened. */
export function unlockHint(writes: GitHubWritesStatus): string {
  return writes.forcedOffReason ?? 'Open the lock in the footer to allow GitHub writes.';
}

/**
 * Why a GitHub-writing action is blocked, or null when it may run. Writes stay
 * blocked until the writes state has loaded, so a slow start can never send one.
 */
export function writeBlockedReason(action: GithubWrite, writes: GitHubWritesStatus | undefined): string | null {
  if (!writes) {
    return `${WHAT[action]} is blocked until the app knows whether GitHub writes are on.`;
  }
  if (writes.enabled || LOCAL_WHEN_OFF[action]) {
    return null;
  }
  return `${WHAT[action]} writes to GitHub, and GitHub writes are off. ${unlockHint(writes)}`;
}

/** Hover text for mark-read style buttons: where the mark-read ends up. */
export function markReadNote(writes: GitHubWritesStatus | undefined): string | undefined {
  if (!writes || writes.enabled) {
    return undefined;
  }
  return 'GitHub writes are off: this marks it read in the app only, GitHub stays unread.';
}
