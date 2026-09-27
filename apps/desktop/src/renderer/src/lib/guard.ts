import type { AppConfig } from '@code-manager/core';

/** Actions that end up as a GitHub write, now or after the undo window. */
export type GithubWrite = 'approve' | 'comment' | 'markRead' | 'notMine';

const WHAT: Record<GithubWrite, string> = {
  approve: 'Approving',
  comment: 'Sending a comment',
  markRead: 'Marking read',
  notMine: '"Not mine"',
};

/**
 * Why a GitHub-writing action is blocked, or null when it may run. Writes stay
 * blocked until the config has loaded, so a slow start can never send one.
 */
export function writeBlockedReason(action: GithubWrite, config: AppConfig | undefined): string | null {
  if (!config) {
    return `${WHAT[action]} is blocked until the app config has loaded.`;
  }
  if (config.writesAllowed) {
    return null;
  }
  return `${WHAT[action]} writes to GitHub and is blocked. Start the app with CODE_MANAGER_ALLOW_WRITES=1 to allow it.`;
}
