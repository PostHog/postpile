import type { Dossier, DossierVersion, Fact, Feedback, FullComment, FullPr, PrEvent, Topic, TopicDelta, Viewer } from '@postpile/core';
import type { PromptContext } from './service.ts';

// Builders for tests. Not a .test.ts file, so vitest does not run it on its own.

export const viewer: Viewer = { login: 'viewer', teams: ['acme/devex'] };

export function makePr(overrides: Partial<FullPr> = {}): FullPr {
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
    headOid: 'abc',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    mergedAt: null,
    mergedBy: null,
    ...overrides,
  };
}

export function makeComment(overrides: Partial<FullComment> = {}): FullComment {
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
    kind: 'project',
    retiredAt: null,
    area: null,
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

export function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 'fact-1',
    subject: { kind: 'person', key: 'alice' },
    predicate: 'drives',
    object: { kind: 'initiative', key: 'topic-1' },
    text: 'Alice drives the Depot move.',
    topicId: 'topic-1',
    source: 'agent',
    refs: [{ kind: 'pr', prKey: 'acme/app#1', sourceId: null, url: null, at: '2026-09-01T10:00:00Z', headOid: null }],
    validFrom: '2026-09-01T10:00:00Z',
    invalidAt: null,
    invalidReason: null,
    supersededBy: null,
    recordedAt: '2026-09-01T11:00:00Z',
    expiredAt: null,
    staleAt: null,
    staleReason: null,
    verifiedAt: null,
    ...overrides,
  };
}

export function makeDossier(overrides: Partial<Dossier> = {}): Dossier {
  return {
    goal: 'Run all CI on Depot runners to cut cost and queue time.',
    summary: 'Test jobs moved; Docker builds next.',
    status: 'blocked',
    statusNote: 'waiting on the runner image PR',
    people: [{ login: 'alice', role: 'driver', note: 'owns the rollout' }],
    openQuestions: [
      {
        text: 'Do we keep GitHub runners for release builds?',
        askedBy: 'carol',
        refs: [{ kind: 'comment', prKey: 'acme/app#1', sourceId: 'c9', url: null, at: '2026-09-10T10:00:00Z', headOid: null }],
      },
    ],
    timeline: [{ prKey: 'acme/app#1', role: 'moves test jobs' }],
    earlier: '',
    userCares: [{ text: 'CI cost and cache keys', source: 'instructions' }],
    recentChanges: [{ at: '2026-09-19T00:00:00.000Z', text: 'Docker build PR opened', refs: [] }],
    ...overrides,
  };
}

export function makeDossierVersion(overrides: Partial<DossierVersion> = {}): DossierVersion {
  return {
    topicId: 'topic-1',
    version: 7,
    dossier: makeDossier(),
    flags: [],
    inputHash: 'h7',
    throughSeq: 40,
    model: 'sonnet',
    createdAt: '2026-09-20T08:00:00.000Z',
    ...overrides,
  };
}

export function makeDelta(overrides: Partial<TopicDelta> = {}): TopicDelta {
  return {
    topicId: 'topic-1',
    fromSeq: 40,
    toSeq: 45,
    skipToSeq: 45,
    events: [],
    omittedEvents: 0,
    joinedPrKeys: [],
    leftPrKeys: [],
    staleFactIds: [],
    staleClaims: [],
    newFeedback: [],
    ...overrides,
  };
}

export const emptyContext: PromptContext = { instructions: '', instructionsVersion: null, tailoring: '', recentFeedback: [], standingRules: [] };

export const fullContext: PromptContext = {
  instructions: 'I am on the devex team. I care about CI cost.',
  instructionsVersion: {
    version: 3,
    text: 'I am on the devex team. I care about CI cost.',
    summary: 'Added CI cost',
    origin: 'chat',
    sourceChatMessageId: 11,
    sourceLessonId: null,
    createdAt: '2026-09-01T08:00:00Z',
  },
  tailoring: 'Flag anything that touches the cache keys.',
  recentFeedback: [makeFeedback()],
  standingRules: ['Never approve database migrations at a glance.'],
};
