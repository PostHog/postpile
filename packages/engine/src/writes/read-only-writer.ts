import type { PrRef } from '@code-manager/core';
import type { GitHubWriter } from '@code-manager/github';

/**
 * What WriteSwitch hands out while GitHub writes are off: the footer lock is
 * closed, or CODE_MANAGER_READ_ONLY=1 forces it (smoke runs against a real
 * account). Every write fails loudly instead of reaching GitHub.
 */
export class ReadOnlyWriter implements GitHubWriter {
  private refuse(what: string): Promise<void> {
    return Promise.reject(new Error(`read-only mode (GitHub writes are off): refused to ${what}`));
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
