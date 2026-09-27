import type { PrRef } from '@code-manager/core';
import { GitHubHttp, type FetchFn } from './http.ts';
import type { TokenSource } from './token.ts';
import type { GitHubWriter } from './writer.ts';

/**
 * Real writer. Only createEngine constructs it; tests and smoke runs never do.
 * Every method throws GitHubError on a non-2xx answer so the caller can show it.
 */
export class GitHubWriteClient implements GitHubWriter {
  private readonly http: GitHubHttp;

  constructor(tokens: TokenSource, fetchFn?: FetchFn) {
    this.http = new GitHubHttp(tokens, fetchFn);
  }

  /** GitHub answers 205 Reset Content. There is no way back: no mark-unread API. */
  async markThreadRead(threadId: string): Promise<void> {
    await this.http.requestOk('PATCH', `notifications/threads/${encodeURIComponent(threadId)}`);
  }

  /** Visible to everyone on the PR; only a dismissal walks it back. */
  async approvePr(ref: PrRef, body: string): Promise<void> {
    const payload: { event: string; body?: string } = { event: 'APPROVE' };
    if (body.trim() !== '') {
      payload.body = body;
    }
    await this.http.requestOk('POST', `repos/${ref.repo}/pulls/${ref.number}/reviews`, { body: payload });
  }

  /** A top-level PR comment. PR conversations are issue comments in the REST API. */
  async commentOnPr(ref: PrRef, body: string): Promise<void> {
    await this.http.requestOk('POST', `repos/${ref.repo}/issues/${ref.number}/comments`, { body: { body } });
  }
}
