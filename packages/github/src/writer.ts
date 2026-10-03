import type { IsoTime, PrRef } from '@postpile/core';

/**
 * Every mutating GitHub call, kept apart from GitHubReader so tests and
 * smoke runs can hold a reader without any way to write.
 *
 * There is no markThreadUnread: GitHub has no API for it. That is why the
 * engine defers markThreadRead behind a 6s undo window.
 */
export interface GitHubWriter {
  markThreadRead(threadId: string): Promise<void>;
  /**
   * PUT /notifications: marks every thread with no activity after
   * `lastReadAt` read, in one call. GitHub may do it asynchronously (202).
   */
  markAllReadBefore(lastReadAt: IsoTime): Promise<void>;
  /** PUT /repos/{repo}/notifications: the same for one repo (`repo` is owner/name). */
  markRepoReadBefore(repo: string, lastReadAt: IsoTime): Promise<void>;
  /** Approves exactly `commitOid`, the head the user looked at, not whatever the head is now. */
  approvePr(ref: PrRef, body: string, commitOid: string): Promise<void>;
  /** A review with event COMMENT on exactly `commitOid`: a review without an approval. `body` is required. */
  commentReviewPr(ref: PrRef, body: string, commitOid: string): Promise<void>;
  commentOnPr(ref: PrRef, body: string): Promise<void>;
  /** Removes the review request of one team (`teamSlug`, no org) from the PR. Everyone on the team stops being asked. */
  removeTeamReviewRequest(ref: PrRef, teamSlug: string): Promise<void>;
  /** Mutes the notification thread until the viewer comments or is mentioned (DELETE its subscription). */
  unsubscribeThread(threadId: string): Promise<void>;
}
