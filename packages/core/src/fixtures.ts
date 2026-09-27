// Builders for tests in any package: `import { makePr } from '@code-manager/core/fixtures'`.
// Not exported from the main index, so app code cannot pick them up by accident.

import type { Timers } from './deferred-queue.ts';
import { prKey } from './keys.ts';
import type {
  Comment,
  Commit,
  NotificationThread,
  Pr,
  PrEvent,
  Review,
  ReviewThread,
  Tile,
  TimelineItem,
  UserPrState,
  Viewer,
} from './types.ts';

export const viewer: Viewer = { login: 'viewer', teams: ['PostHog/team-devex'] };

/** Minutes after a fixed base time, as ISO. Keeps test timelines readable. */
export function at(minutes: number): string {
  return new Date(Date.UTC(2026, 8, 1, 9, 0) + minutes * 60_000).toISOString();
}

export function makePr(overrides: Partial<Pr> & { number?: number; repo?: string } = {}): Pr {
  const { number = 1, repo = 'PostHog/posthog', ...rest } = overrides;
  const ref = { repo, number };
  return {
    key: prKey(ref),
    ref,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    body: '',
    author: 'alice',
    state: 'OPEN',
    isDraft: false,
    baseRef: 'master',
    headRef: `branch-${number}`,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    files: [],
    labels: [],
    reviewDecision: 'REVIEW_REQUIRED',
    reviewerUsers: [],
    reviewerTeams: [],
    reviews: [],
    commits: [],
    comments: [],
    threads: [],
    timeline: [],
    checks: { rollup: 'NONE', contexts: [] },
    headOid: 'head',
    createdAt: at(0),
    updatedAt: at(0),
    mergedAt: null,
    mergedBy: null,
    ...rest,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    author: 'bob',
    body: 'looks fine',
    createdAt: at(10),
    kind: 'comment',
    url: 'https://github.com/PostHog/posthog/pull/1#issuecomment-1',
    path: null,
    threadId: null,
    ...overrides,
  };
}

export function makeThread(id: string, comments: Comment[]): ReviewThread {
  return {
    id,
    path: 'a.ts',
    isResolved: false,
    comments: comments.map((c) => ({ ...c, kind: 'review_comment' as const, threadId: id, path: 'a.ts' })),
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    author: 'bob',
    state: 'APPROVED',
    body: '',
    submittedAt: at(20),
    commitOid: 'head',
    ...overrides,
  };
}

export function makeCommit(overrides: Partial<Commit> = {}): Commit {
  return { oid: 'head', headline: 'do the thing', author: 'alice', committedAt: at(5), ...overrides };
}

export function makeTimelineItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return { id: 't1', kind: 'review_requested', actor: 'alice', at: at(1), subject: viewer.login, ...overrides };
}

export function makeThreadFor(pr: Pr, overrides: Partial<NotificationThread> = {}): NotificationThread {
  return {
    id: `thread-${pr.ref.number}`,
    reason: 'review_requested',
    unread: true,
    updatedAt: pr.updatedAt,
    lastReadAt: null,
    subjectType: 'PullRequest',
    repo: pr.ref.repo,
    number: pr.ref.number,
    title: pr.title,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<PrEvent> = {}): PrEvent {
  return {
    id: 'PostHog/posthog#1:comment:c1',
    prKey: 'PostHog/posthog#1',
    kind: 'comment',
    actor: 'bob',
    isBot: false,
    at: at(10),
    summary: 'bob commented',
    url: null,
    sourceId: 'c1',
    ruleLoudness: 'quiet',
    ruleReason: 'comment',
    override: null,
    seenAt: null,
    ...overrides,
  };
}

export function makeUserState(overrides: Partial<UserPrState> = {}): UserPrState {
  return { prKey: 'PostHog/posthog#1', approvedAt: null, approvedCommitOid: null, handledAt: null, ...overrides };
}

export function singleTile(pr: Pr, pinged = true): Tile {
  return {
    id: `pr:${pr.key}`,
    topicId: 'topic-1',
    kind: 'single',
    title: pr.title,
    members: [
      {
        prKey: pr.key,
        provenance: pinged ? { kind: 'pinged', reason: 'review_requested' } : { kind: 'pulled_in', reason: 'context' },
      },
    ],
  };
}

/** Hand-cranked clock: nothing fires until advance() says so. */
export class FakeTimers implements Timers {
  private time = 1000;
  private nextId = 1;
  private readonly scheduled = new Map<number, { dueAt: number; fn: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.scheduled.set(id, { dueAt: this.time + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }

  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of [...this.scheduled.entries()]) {
      if (timer.dueAt <= this.time) {
        this.scheduled.delete(id);
        timer.fn();
      }
    }
  }
}
