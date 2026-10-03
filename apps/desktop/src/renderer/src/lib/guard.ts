import type { GitHubWritesStatus } from '@postpile/core';

/** Actions that end up as a GitHub write, now or after the undo window. */
export type GithubWrite = 'approve' | 'commentReview' | 'comment' | 'markRead' | 'notMine' | 'cleanup' | 'openedRead' | 'removeTeam';

const WHAT: Record<GithubWrite, string> = {
  approve: 'Approving',
  commentReview: 'Posting a comment review',
  comment: 'Sending a comment',
  markRead: 'Marking read',
  notMine: '"Not mine"',
  cleanup: 'The inbox cleanup',
  openedRead: 'Marking an opened PR read',
  removeTeam: 'Removing a team review request',
};

/**
 * Mark-reads (and the inbox cleanup, one pending write for all it clears) still run with GitHub writes locked: they change nothing in the
 * app and wait as pending writes until the user unlocks and sends them (or
 * discards them). Approve, comment review and comment have no pending queue, so they are
 * blocked while the lock is closed. So is the mark-read on opening a PR:
 * nobody clicked it, so it never piles up as a pending write. Removing a
 * team review request is final like Approve, so it is blocked too.
 */
const LOCAL_WHEN_OFF: Record<GithubWrite, boolean> = {
  approve: false,
  commentReview: false,
  comment: false,
  markRead: true,
  notMine: true,
  cleanup: true,
  openedRead: false,
  removeTeam: false,
};

/** How to open the lock, or why it cannot be opened. */
function unlockHint(writes: GitHubWritesStatus): string {
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
  return 'GitHub writes are locked: this becomes a pending write. The tile stays unread until you unlock and send it from the footer.';
}

/** Tooltip of the pending marker on a tile. */
export function pendingWriteTitle(error: string | null): string {
  const base =
    'Pending: this mark-read waits for GitHub. GitHub writes were locked, so nothing changed here yet; the tile stays unread until you unlock and send it from the footer lock, or discard it.';
  return error ? `${base}\nLast try failed: ${error}` : base;
}
