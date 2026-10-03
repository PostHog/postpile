import type { PrRef } from '@postpile/core';
import type { GitHubWriter } from '@postpile/github';

/**
 * What WriteSwitch hands out while GitHub writes are off: the footer lock is
 * closed, or POSTPILE_READ_ONLY=1 forces it (smoke runs against a real
 * account). Every write fails loudly instead of reaching GitHub.
 */
export class ReadOnlyWriter implements GitHubWriter {
  private refuse(what: string): Promise<void> {
    return Promise.reject(new Error(`read-only mode (GitHub writes are off): refused to ${what}`));
  }

  markThreadRead(threadId: string): Promise<void> {
    return this.refuse(`mark thread ${threadId} read`);
  }

  markAllReadBefore(lastReadAt: string): Promise<void> {
    return this.refuse(`mark everything before ${lastReadAt} read`);
  }

  markRepoReadBefore(repo: string, lastReadAt: string): Promise<void> {
    return this.refuse(`mark everything in ${repo} before ${lastReadAt} read`);
  }

  approvePr(ref: PrRef): Promise<void> {
    return this.refuse(`approve ${ref.repo}#${ref.number}`);
  }

  commentReviewPr(ref: PrRef): Promise<void> {
    return this.refuse(`post a comment review on ${ref.repo}#${ref.number}`);
  }

  commentOnPr(ref: PrRef): Promise<void> {
    return this.refuse(`comment on ${ref.repo}#${ref.number}`);
  }

  removeTeamReviewRequest(ref: PrRef, teamSlug: string): Promise<void> {
    return this.refuse(`remove ${teamSlug}'s review request from ${ref.repo}#${ref.number}`);
  }

  unsubscribeThread(threadId: string): Promise<void> {
    return this.refuse(`unsubscribe from thread ${threadId}`);
  }
}
