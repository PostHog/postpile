import type { Comment, Feedback, Pr, PrEvent, Topic, Viewer } from '@code-manager/core';
import type { PromptContext } from './service.ts';

// Builders for tests. Not a .test.ts file, so vitest does not run it on its own.

export const viewer: Viewer = { login: 'viewer', teams: ['acme/devex'] };

export function makePr(overrides: Partial<Pr> = {}): Pr {
  const number = overrides.ref?.number ?? 1;
  const repo = overrides.ref?.repo ?? 'acme/app';
  return {
    key: `${repo}#${number}`,
    ref: { repo, number },
    title: 'Move CI to Depot',
    url: `https://github.com/${repo}/pull/${number}`,
    body: 'Switches runners to depot.',
    author: 'alice',
    state: 'OPEN',
    isDraft: false,
    baseRef: 'main',
    headRef: `alice/branch-${number}`,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    files: [{ path: '.github/workflows/ci.yml', additions: 10, deletions: 2 }],
    labels: [],
    reviewDecision: 'REVIEW_REQUIRED',
    reviewerUsers: ['viewer'],
    reviewerTeams: [],
    reviews: [],
    commits: [],
    comments: [],
    threads: [],
    timeline: [],
    checks: { rollup: 'SUCCESS', contexts: [] },
    headOid: 'abc',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    mergedAt: null,
    mergedBy: null,
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    author: 'bob',
    body: 'Looks fine to me',
    createdAt: '2026-09-02T09:00:00Z',
    kind: 'comment',
    url: 'https://github.com/acme/app/pull/1#c1',
    path: null,
    threadId: null,
    ...overrides,
  };
}

export function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    name: 'Move CI to Depot',
    summary: 'CI moves from GitHub runners to Depot.',
    summaryInputHash: null,
    tailoring: '',
    driver: 'alice',
    userRole: 'reviewer',
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

export function makeFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 1,
    kind: 'not_mine',
    topicId: 'topic-1',
    tileId: null,
    prKey: 'acme/app#9',
    setId: null,
    eventId: null,
    note: 'frontend PRs are never mine',
    createdAt: '2026-09-20T12:00:00Z',
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<PrEvent> = {}): PrEvent {
  return {
    id: 'acme/app#1:comment:c1',
    prKey: 'acme/app#1',
    kind: 'comment',
    actor: 'bob',
    isBot: false,
    at: '2026-09-02T09:00:00Z',
    summary: 'bob commented',
    url: null,
    sourceId: 'c1',
    ruleLoudness: 'quiet',
    ruleReason: 'plain comment',
    override: null,
    seenAt: null,
    ...overrides,
  };
}

export const emptyContext: PromptContext = { instructions: '', tailoring: '', recentFeedback: [] };

export const fullContext: PromptContext = {
  instructions: 'I am on the devex team. I care about CI cost.',
  tailoring: 'Flag anything that touches the cache keys.',
  recentFeedback: [makeFeedback()],
};
