import type { NotificationDebugRow, NotificationLanding, NotificationReason } from '@code-manager/core';

export interface NotificationFilter {
  /** Null shows every reason. */
  reason: NotificationReason | null;
  unreadOnly: boolean;
  /** Matched against repo#number, title, topic and tile title, case-insensitive. */
  text: string;
}

export const NO_NOTIFICATION_FILTER: NotificationFilter = { reason: null, unreadOnly: false, text: '' };

/** "PostHog/posthog#41902", or just the repo for subjects without a number. */
export function threadRef(row: NotificationDebugRow): string {
  return row.thread.number === null ? row.thread.repo : `${row.thread.repo}#${row.thread.number}`;
}

/** Short label for the "landed in" column. */
export function landingLabel(landing: NotificationLanding): string {
  switch (landing.kind) {
    case 'tile':
      return landing.unsorted ? `Unsorted › ${landing.tileTitle}` : `${landing.topicName} › ${landing.tileTitle}`;
    case 'not_pr':
      return 'not a PR';
    case 'pr_not_synced':
      return 'PR not synced';
    case 'no_topic':
      return 'no topic';
    case 'topic_hidden':
      return `${landing.topicName} (hidden)`;
    case 'no_tile':
      return `${landing.topicName}, no tile`;
  }
}

/** Why a row has no tile to jump to, shown inline when it is clicked. Null when it has one. */
export function noTileReason(landing: NotificationLanding): string | null {
  switch (landing.kind) {
    case 'tile':
      return null;
    case 'not_pr':
      return 'Not a pull request. Only PR threads become tiles.';
    case 'pr_not_synced':
      return 'The PR was never fetched: the sync stopped at its PR limit or the fetch failed. The next sync picks it up.';
    case 'no_topic':
      return 'The PR is stored but sits in no topic and is not waiting in Unsorted.';
    case 'topic_hidden':
      return `Its topic "${landing.topicName}" was merged away or archived, so no tile shows it.`;
    case 'no_tile':
      return `It belongs to "${landing.topicName}", but no tile there holds it.`;
  }
}

/** Reasons present in the rows, in first-seen order, for the reason picker. */
export function reasonsIn(rows: NotificationDebugRow[]): NotificationReason[] {
  return [...new Set(rows.map((row) => row.thread.reason))];
}

function haystack(row: NotificationDebugRow): string {
  return [threadRef(row), row.thread.title, row.thread.subjectType, landingLabel(row.landing)].join(' ').toLowerCase();
}

/** Rows that pass every filter; keeps the server's order (newest first). */
export function filterNotifications(rows: NotificationDebugRow[], filter: NotificationFilter): NotificationDebugRow[] {
  const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (row) =>
      (filter.reason === null || row.thread.reason === filter.reason) &&
      (!filter.unreadOnly || row.thread.unread) &&
      terms.every((term) => haystack(row).includes(term)),
  );
}
