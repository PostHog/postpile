import type { CleanupAge, InboxCleanupView } from '@postpile/core';

/** "12 unread older than 14 days". */
export function backlogText(view: InboxCleanupView): string {
  return `${view.unreadOlderThan14} unread older than 14 days`;
}

/** The radio rows of the dialog: count per cutoff. */
export function cleanupChoices(view: InboxCleanupView): { age: CleanupAge; count: number }[] {
  return [
    { age: 14, count: view.unreadOlderThan14 },
    { age: 30, count: view.unreadOlderThan30 },
  ];
}

/** "Sep 28" from an ISO time, in the viewer's locale. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
