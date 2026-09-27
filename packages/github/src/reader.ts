import type { NotificationThread, Pr, PrKey, PrRef, Viewer } from '@code-manager/core';

export interface NotificationConditions {
  etag: string | null;
  lastModified: string | null;
}

export type NotificationsResult =
  | { notModified: true }
  | { notModified: false; threads: NotificationThread[]; etag: string | null; lastModified: string | null };

/** Every read GitHub call the app makes. Safe to use against the real API in smoke tests. */
export interface GitHubReader {
  viewer(): Promise<Viewer>;

  /**
   * Walks the whole unread inbox (all pages). Sends the previous ETag and
   * Last-Modified so an unchanged inbox returns 304 and costs nothing.
   */
  listNotifications(conditions: NotificationConditions): Promise<NotificationsResult>;

  /** One thread by id, read or unread. Null when GitHub answers 404. */
  getThread(threadId: string): Promise<NotificationThread | null>;

  /** Batched GraphQL enrichment, PR_BATCH_SIZE PRs aliased per query. Missing PRs are left out. */
  fetchPrs(refs: PrRef[]): Promise<Map<PrKey, Pr>>;
}

/** PRs aliased per GraphQL query. 12 kept ghatchup well inside the node limit. */
export const PR_BATCH_SIZE = 12;
