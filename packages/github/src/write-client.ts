import type { IsoTime, PrRef } from '@postpile/core';
import { GitHubHttp, graphqlFailure, type FetchFn } from './http.ts';
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

  /**
   * https://docs.github.com/en/rest/activity/notifications#mark-notifications-as-read
   * Threads updated after `lastReadAt` stay unread. 205 when done, 202 when
   * GitHub finishes it in the background; either way the next read shows it.
   */
  async markAllReadBefore(lastReadAt: IsoTime): Promise<void> {
    await this.http.requestOk('PUT', 'notifications', { body: { last_read_at: lastReadAt, read: true } });
  }

  /**
   * https://docs.github.com/en/rest/activity/notifications#mark-repository-notifications-as-read
   * The same for one repo: threads updated after `lastReadAt` stay unread. 205 or 202.
   */
  async markRepoReadBefore(repo: string, lastReadAt: IsoTime): Promise<void> {
    await this.http.requestOk('PUT', `repos/${repo}/notifications`, { body: { last_read_at: lastReadAt } });
  }

  /**
   * https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request
   * Visible to everyone on the PR; only a dismissal walks it back.
   * commit_id pins the review to the commit the user saw. Without it GitHub
   * reviews the current head, which may include pushes made after the last sync.
   */
  private async postReview(ref: PrRef, event: 'APPROVE' | 'COMMENT', commitOid: string, body: string | null): Promise<void> {
    const payload: { event: string; commit_id: string; body?: string } = { event, commit_id: commitOid };
    if (body !== null) {
      payload.body = body;
    }
    await this.http.requestOk('POST', `repos/${ref.repo}/pulls/${ref.number}/reviews`, { body: payload });
  }

  /** An empty body sends none. */
  async approvePr(ref: PrRef, body: string, commitOid: string): Promise<void> {
    await this.postReview(ref, 'APPROVE', commitOid, body.trim() === '' ? null : body);
  }

  /**
   * A review with event COMMENT: answers a review request without approving,
   * and branch protection does not count it as an approval. GitHub requires
   * the body for this event.
   */
  async commentReviewPr(ref: PrRef, body: string, commitOid: string): Promise<void> {
    await this.postReview(ref, 'COMMENT', commitOid, body);
  }

  /** A top-level PR comment. PR conversations are issue comments in the REST API. */
  async commentOnPr(ref: PrRef, body: string): Promise<void> {
    await this.http.requestOk('POST', `repos/${ref.repo}/issues/${ref.number}/comments`, { body: { body } });
  }

  /**
   * A GraphQL mutation. GitHub answers 200 with errors when it refuses one
   * (no access, unknown node), so those throw like a failed REST call.
   */
  private async mutate(what: string, mutation: string, variables: Record<string, unknown>): Promise<void> {
    const result = await this.http.graphql<unknown>(mutation, variables);
    if (result.errors.length > 0 || result.data === null) {
      throw graphqlFailure(what, result.errors);
    }
  }

  /**
   * https://docs.github.com/en/graphql/reference/mutations#addpullrequestreviewthreadreply
   * Posted right away, outside any pending review of the viewer.
   */
  async replyInThread(threadId: string, body: string): Promise<void> {
    const mutation = `mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { id } }
}`;
    await this.mutate('thread reply', mutation, { threadId, body });
  }

  /**
   * https://docs.github.com/en/graphql/reference/mutations#addreaction
   * Takes the node id of an IssueComment, PullRequestReviewComment or
   * PullRequestReview. Adding a reaction the viewer already has is a no-op on GitHub.
   */
  async addThumbsUp(subjectId: string): Promise<void> {
    const mutation = `mutation($subjectId: ID!) {
  addReaction(input: { subjectId: $subjectId, content: THUMBS_UP }) { reaction { content } }
}`;
    await this.mutate('reaction', mutation, { subjectId });
  }

  /**
   * https://docs.github.com/en/rest/pulls/review-requests#remove-requested-reviewers-from-a-pull-request
   * Only the team's request goes; personal requests stay. Re-adding the team
   * notifies every member again, so there is no undo.
   */
  async removeTeamReviewRequest(ref: PrRef, teamSlug: string): Promise<void> {
    await this.http.requestOk('DELETE', `repos/${ref.repo}/pulls/${ref.number}/requested_reviewers`, {
      body: { reviewers: [], team_reviewers: [teamSlug] },
    });
  }

  /**
   * https://docs.github.com/en/rest/activity/notifications#delete-a-thread-subscription
   * 204. Mutes the thread until the viewer comments or is @mentioned; direct
   * review requests still arrive.
   */
  async unsubscribeThread(threadId: string): Promise<void> {
    await this.http.requestOk('DELETE', `notifications/threads/${encodeURIComponent(threadId)}/subscription`);
  }
}
