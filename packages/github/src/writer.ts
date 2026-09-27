import type { PrRef } from '@code-manager/core';

/**
 * Every mutating GitHub call, kept apart from GitHubReader so tests and
 * smoke runs can hold a reader without any way to write.
 *
 * There is no markThreadUnread: GitHub has no API for it. That is why the
 * engine defers markThreadRead behind a 6s undo window.
 */
export interface GitHubWriter {
  markThreadRead(threadId: string): Promise<void>;
  /** Approves exactly `commitOid`, the head the user looked at, not whatever the head is now. */
  approvePr(ref: PrRef, body: string, commitOid: string): Promise<void>;
  commentOnPr(ref: PrRef, body: string): Promise<void>;
}
