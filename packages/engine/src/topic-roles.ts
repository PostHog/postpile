import { sameLogin, type NotificationReason, type Pr, type UserRole } from '@code-manager/core';

/** Whoever authored most of the topic's PRs. Ties go to the author seen first. */
export function topicDriver(prs: Pr[]): string | null {
  const counts = new Map<string, number>();
  for (const pr of prs) {
    if (pr.author === '') {
      continue;
    }
    counts.set(pr.author, (counts.get(pr.author) ?? 0) + 1);
  }
  let driver: string | null = null;
  let best = 0;
  for (const [author, count] of counts) {
    if (count > best) {
      driver = author;
      best = count;
    }
  }
  return driver;
}

const stakeholderReasons: NotificationReason[] = ['mention', 'team_mention', 'author', 'assign', 'comment'];

/** The user's role follows from who drives the topic and why GitHub pinged them. */
export function userRoleFor(viewerLogin: string, driver: string | null, reasons: NotificationReason[]): UserRole {
  if (driver !== null && sameLogin(driver, viewerLogin)) {
    return 'driver';
  }
  if (reasons.includes('review_requested')) {
    return 'reviewer';
  }
  if (reasons.some((reason) => stakeholderReasons.includes(reason))) {
    return 'stakeholder';
  }
  return 'watcher';
}
