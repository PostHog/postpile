// Small builders that keep sample-data.ts readable. Everything here fills in
// the fields a fake does not care about with plain defaults.
import { prKey } from '@postpile/core';
import type {
  CheckRollup,
  ReviewDecision,
  EventKind,
  Glance,
  KeyFile,
  Loudness,
  Pr,
  PrEvent,
  PrKey,
  PrState,
  Provenance,
  ReviewState,
  Tile,
  TileKind,
  TileMember,
  Topic,
  UserRole,
  Verdict,
} from '@postpile/core';

export const SAMPLE_REPO = 'acme/app';
export const SAMPLE_VIEWER = 'you';
/** A coding agent's GitHub App: opens PRs for people and assigns them. */
export const SAMPLE_AGENT = 'acme-agent[bot]';

/**
 * Sample PRs outside the main repo, so the title bar's repo menu has more
 * than one row and the Depot topic shows a repo label on its acme/infra tile.
 */
const OTHER_REPOS: Record<number, string> = {
  1915: 'acme/infra',
  1925: 'acme/python-sdk',
  1966: 'acme/python-sdk',
  1967: 'acme/python-sdk',
  1940: 'acme/desktop',
};

export function sampleRepo(number: number): string {
  return OTHER_REPOS[number] ?? SAMPLE_REPO;
}

export class SampleClock {
  constructor(private readonly now: Date) {}

  hoursAgo(hours: number): string {
    return new Date(this.now.getTime() - hours * 3_600_000).toISOString();
  }
}

export function sampleKey(number: number): PrKey {
  return prKey({ repo: sampleRepo(number), number });
}

export interface SampleCommentInput {
  id: string;
  author: string;
  body: string;
  hoursAgo: number;
}

export interface SampleCommitInput {
  oid: string;
  headline: string;
  hoursAgo: number;
}

export interface SampleThreadInput {
  id: string;
  path: string;
  /** Comments in order; the first one opens the thread. */
  comments: { author: string; body: string; hoursAgo: number }[];
  resolved?: boolean;
}

export interface SamplePrInput {
  number: number;
  title: string;
  author: string;
  /** Assigned users; an agent PR (a bot author) belongs to them. */
  assignees?: string[];
  state: PrState;
  size: [additions: number, deletions: number, files: number];
  checks: CheckRollup;
  baseRef?: string;
  headRef?: string;
  openedHoursAgo: number;
  mergedHoursAgo?: number;
  /**
   * commitOid defaults to the head; pass an older one for "commits after
   * approval". hoursAgo defaults to 1; set it for a review older than later pushes.
   */
  reviews?: [author: string, state: ReviewState, body?: string, commitOid?: string, hoursAgo?: number][];
  reviewerUsers?: string[];
  reviewerTeams?: string[];
  body?: string;
  /** Issue comments, so memory sources in fake mode have who and what to show. */
  comments?: SampleCommentInput[];
  /** Commits by the author, oldest first. The last one should be the head (`sha<number>`). */
  commits?: SampleCommitInput[];
  /** Inline review threads. */
  threads?: SampleThreadInput[];
  /** In the merge queue: adds an added_to_merge_queue timeline item. */
  queued?: boolean;
  /** A draft: never a review move, only personal asks count. */
  draft?: boolean;
  /** Changed files with their +/- counts; empty by default like a PR fetched without files. */
  files?: [path: string, additions: number, deletions: number][];
}

/** Like GitHub with a review rule: a standing change request wins, then any approval. */
function sampleReviewDecision(reviews: [string, ReviewState, string?, string?, number?][]): ReviewDecision {
  if (reviews.some(([, state]) => state === 'CHANGES_REQUESTED')) {
    return 'CHANGES_REQUESTED';
  }
  return reviews.some(([, state]) => state === 'APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED';
}

export function samplePr(clock: SampleClock, input: SamplePrInput): Pr {
  const key = sampleKey(input.number);
  const repo = sampleRepo(input.number);
  const headOid = `sha${input.number}`;
  const mergedAt = input.mergedHoursAgo === undefined ? null : clock.hoursAgo(input.mergedHoursAgo);
  const [additions, deletions, changedFiles] = input.size;
  return {
    key,
    ref: { repo, number: input.number },
    title: input.title,
    url: `https://github.com/${repo}/pull/${input.number}`,
    body: input.body ?? '',
    author: input.author,
    assignees: input.assignees ?? [],
    state: input.state,
    isDraft: input.draft ?? false,
    baseRef: input.baseRef ?? 'master',
    headRef: input.headRef ?? `${input.author}/pr-${input.number}`,
    additions,
    deletions,
    changedFiles,
    files: (input.files ?? []).map(([path, fileAdditions, fileDeletions]) => ({ path, additions: fileAdditions, deletions: fileDeletions })),
    labels: [],
    reviewDecision: sampleReviewDecision(input.reviews ?? []),
    reviewerUsers: input.reviewerUsers ?? [],
    reviewerTeams: input.reviewerTeams ?? [],
    reviews: (input.reviews ?? []).map(([author, state, body, commitOid, hoursAgo], index) => ({
      id: `review-${input.number}-${index}`,
      author,
      state,
      body: body ?? '',
      submittedAt: clock.hoursAgo(hoursAgo ?? 1),
      commitOid: commitOid ?? headOid,
    })),
    commits: (input.commits ?? []).map((commit) => ({
      oid: commit.oid,
      headline: commit.headline,
      author: input.author,
      committer: input.author,
      committedAt: clock.hoursAgo(commit.hoursAgo),
    })),
    comments: (input.comments ?? []).map((comment) => ({
      id: comment.id,
      author: comment.author,
      body: comment.body,
      createdAt: clock.hoursAgo(comment.hoursAgo),
      kind: 'comment' as const,
      url: `https://github.com/${repo}/pull/${input.number}#${comment.id}`,
      path: null,
      threadId: null,
    })),
    threads: (input.threads ?? []).map((thread) => ({
      id: thread.id,
      path: thread.path,
      isResolved: thread.resolved ?? false,
      comments: thread.comments.map((comment, index) => ({
        id: `${thread.id}-${index}`,
        author: comment.author,
        body: comment.body,
        createdAt: clock.hoursAgo(comment.hoursAgo),
        kind: 'review_comment' as const,
        url: `https://github.com/${repo}/pull/${input.number}#discussion_${thread.id}`,
        path: thread.path,
        threadId: thread.id,
      })),
    })),
    timeline: input.queued
      ? [{ id: `queue-${input.number}`, kind: 'added_to_merge_queue' as const, actor: 'mergify[bot]', at: clock.hoursAgo(1), subject: null }]
      : [],
    checks: { rollup: input.checks, contexts: [] },
    headOid,
    createdAt: clock.hoursAgo(input.openedHoursAgo),
    updatedAt: clock.hoursAgo(input.mergedHoursAgo ?? 0),
    mergedAt,
    mergedBy: mergedAt ? input.author : null,
  };
}

export interface SampleEventInput {
  kind: EventKind;
  actor: string;
  /** Appended to the actor for the one-line summary. */
  text: string;
  hoursAgo: number;
  rule: Loudness;
  /** The id of the sample comment or review this event is about, so the detail pane can show its full text. */
  sourceId?: string;
  seen?: boolean;
  isBot?: boolean;
  /** Set when the agent muted the event, with its reason. */
  mutedBecause?: string;
  /** The agent raised a quiet event to loud with this reason (e.g. a push after approval that matters). */
  raisedBecause?: string;
}

export function sampleEvents(clock: SampleClock, number: number, inputs: SampleEventInput[]): PrEvent[] {
  const key = sampleKey(number);
  return inputs.map((input, index) => {
    const sourceId = input.sourceId ?? `s${number}-${index}`;
    const at = clock.hoursAgo(input.hoursAgo);
    return {
      id: `${key}:${input.kind}:${sourceId}`,
      prKey: key,
      kind: input.kind,
      actor: input.actor,
      isBot: input.isBot ?? false,
      at,
      summary: `${input.actor} ${input.text}`,
      url: null,
      sourceId,
      ruleLoudness: input.rule,
      ruleReason: 'sample data',
      override: input.mutedBecause
        ? { loudness: 'muted', reason: input.mutedBecause, by: 'agent' }
        : input.raisedBecause
          ? { loudness: 'loud', reason: input.raisedBecause, by: 'agent' }
          : null,
      seenAt: input.seen ? at : null,
    };
  });
}

export interface SampleGlanceInput {
  verdict: Verdict;
  forYou: string;
  does: string;
  risk: string;
  othersSaid: string;
  keyFiles?: KeyFile[];
  pullInReason?: string;
}

export function sampleGlance(clock: SampleClock, number: number, input: SampleGlanceInput): Glance {
  return {
    prKey: sampleKey(number),
    verdict: input.verdict,
    forYou: input.forYou,
    does: input.does,
    risk: input.risk,
    othersSaid: input.othersSaid,
    keyFiles: input.keyFiles ?? [],
    pullInReason: input.pullInReason ?? null,
    dossierVersion: null,
    inputHash: `sample-${number}`,
    model: 'sample',
    createdAt: clock.hoursAgo(0),
  };
}

export interface SampleTopicInput {
  id: string;
  name: string;
  summary: string;
  tailoring: string;
  driver: string | null;
  userRole: UserRole;
  area: string | null;
}

export function sampleTopic(clock: SampleClock, input: SampleTopicInput): Topic {
  return {
    ...input,
    summaryInputHash: null,
    status: 'active',
    retiredAt: null,
    createdAt: clock.hoursAgo(24 * 14),
    updatedAt: clock.hoursAgo(1),
  };
}

export function pinged(number: number, reason: Extract<Provenance, { kind: 'pinged' }>['reason']): TileMember {
  return { prKey: sampleKey(number), provenance: { kind: 'pinged', reason } };
}

/** A PR the sync found outside the inbox (own open PR, review request, recent merge). */
export function found(number: number, via: Extract<Provenance, { kind: 'found' }>['via'], reason: string): TileMember {
  return { prKey: sampleKey(number), provenance: { kind: 'found', via, reason } };
}

export function pulledIn(number: number, reason: string): TileMember {
  return { prKey: sampleKey(number), provenance: { kind: 'pulled_in', reason } };
}

/**
 * A stack tile's members are its layers, bottom first, so it carries that one
 * stack. A set passes the stacks inside it as PR numbers, bottom first.
 */
export function sampleTile(topicId: string, kind: TileKind, id: string, title: string, members: TileMember[], setStacks: number[][] = []): Tile {
  if (kind === 'stack') {
    return { id, topicId, kind, title, members, stacks: [{ id, prKeys: members.map((member) => member.prKey) }] };
  }
  const stacks = setStacks.map((numbers) => ({ id: `stack:${sampleKey(numbers[0]!)}`, prKeys: numbers.map(sampleKey) }));
  return { id, topicId, kind, title, members, stacks };
}
