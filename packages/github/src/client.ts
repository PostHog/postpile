import type { Pr, PrKey, PrRef, Viewer } from '@code-manager/core';
import type { GitHubReader, NotificationConditions, NotificationsResult } from './reader.ts';
import type { TokenSource } from './token.ts';
import type { GitHubWriter } from './writer.ts';

/** Real reader over REST (notifications) and GraphQL (PRs). */
export class GitHubClient implements GitHubReader {
  constructor(private readonly tokens: TokenSource) {}

  viewer(): Promise<Viewer> {
    throw new Error('not implemented');
  }

  listNotifications(_conditions: NotificationConditions): Promise<NotificationsResult> {
    throw new Error('not implemented');
  }

  fetchPrs(_refs: PrRef[]): Promise<Map<PrKey, Pr>> {
    throw new Error('not implemented');
  }
}

/** Real writer. Never constructed in tests or smoke runs. */
export class GitHubWriteClient implements GitHubWriter {
  constructor(private readonly tokens: TokenSource) {}

  markThreadRead(_threadId: string): Promise<void> {
    throw new Error('not implemented');
  }

  approvePr(_ref: PrRef, _body: string): Promise<void> {
    throw new Error('not implemented');
  }

  commentOnPr(_ref: PrRef, _body: string): Promise<void> {
    throw new Error('not implemented');
  }
}
