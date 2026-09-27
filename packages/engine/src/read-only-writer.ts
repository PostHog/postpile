import type { PrRef } from '@code-manager/core';
import type { GitHubWriter } from '@code-manager/github';

/**
 * Stands in for the real writer when CODE_MANAGER_READ_ONLY=1, e.g. in smoke
 * runs against a real account. Every write fails loudly instead of reaching GitHub.
 */
export class ReadOnlyWriter implements GitHubWriter {
  private refuse(what: string): Promise<void> {
    return Promise.reject(new Error(`read-only mode (CODE_MANAGER_READ_ONLY=1): refused to ${what}`));
  }

  markThreadRead(threadId: string): Promise<void> {
    return this.refuse(`mark thread ${threadId} read`);
  }

  approvePr(ref: PrRef): Promise<void> {
    return this.refuse(`approve ${ref.repo}#${ref.number}`);
  }

  commentOnPr(ref: PrRef): Promise<void> {
    return this.refuse(`comment on ${ref.repo}#${ref.number}`);
  }
}
