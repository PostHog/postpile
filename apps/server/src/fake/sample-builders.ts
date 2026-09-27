// Small builders that keep sample-data.ts readable. Everything here fills in
// the fields a fake does not care about with plain defaults.
import { prKey } from '@code-manager/core';
import type {
  CheckRollup,
  EventKind,
  Glance,
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
} from '@code-manager/core';

export const SAMPLE_REPO = 'PostHog/posthog';
export const SAMPLE_VIEWER = 'you';

export class SampleClock {
  constructor(private readonly now: Date) {}

  hoursAgo(hours: number): string {
    return new Date(this.now.getTime() - hours * 3_600_000).toISOString();
  }
}

export function sampleKey(number: number): PrKey {
  return prKey({ repo: SAMPLE_REPO, number });
}

export interface SamplePrInput {
  number: number;
  title: string;
  author: string;
  state: PrState;
  size: [additions: number, deletions: number, files: number];
  checks: CheckRollup;
  baseRef?: string;
  headRef?: string;
  openedHoursAgo: number;
  mergedHoursAgo?: number;
  reviews?: [author: string, state: ReviewState][];
  reviewerUsers?: string[];
  reviewerTeams?: string[];
  body?: string;
}

export function samplePr(clock: SampleClock, input: SamplePrInput): Pr {
  const key = sampleKey(input.number);
  const headOid = `sha${input.number}`;
  const mergedAt = input.mergedHoursAgo === undefined ? null : clock.hoursAgo(input.mergedHoursAgo);
  const [additions, deletions, changedFiles] = input.size;
  return {
    key,
    ref: { repo: SAMPLE_REPO, number: input.number },
    title: input.title,
    url: `https://github.com/${SAMPLE_REPO}/pull/${input.number}`,
    body: input.body ?? '',
    author: input.author,
    state: input.state,
    isDraft: false,
    baseRef: input.baseRef ?? 'master',
    headRef: input.headRef ?? `${input.author}/pr-${input.number}`,
    additions,
    deletions,
    changedFiles,
    files: [],
    labels: [],
    reviewDecision: 'REVIEW_REQUIRED',
    reviewerUsers: input.reviewerUsers ?? [],
    reviewerTeams: input.reviewerTeams ?? [],
    reviews: (input.reviews ?? []).map(([author, state], index) => ({
      id: `review-${input.number}-${index}`,
      author,
      state,
      body: '',
      submittedAt: clock.hoursAgo(1),
      commitOid: headOid,
    })),
    commits: [],
    comments: [],
    threads: [],
    timeline: [],
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
  seen?: boolean;
  isBot?: boolean;
  /** Set when the agent muted the event, with its reason. */
  mutedBecause?: string;
}

export function sampleEvents(clock: SampleClock, number: number, inputs: SampleEventInput[]): PrEvent[] {
  const key = sampleKey(number);
  return inputs.map((input, index) => {
    const sourceId = `s${number}-${index}`;
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
      override: input.mutedBecause ? { loudness: 'muted', reason: input.mutedBecause, by: 'agent' } : null,
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
    pullInReason: input.pullInReason ?? null,
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
}

export function sampleTopic(clock: SampleClock, input: SampleTopicInput): Topic {
  return {
    ...input,
    summaryInputHash: null,
    status: 'active',
    createdAt: clock.hoursAgo(24 * 14),
    updatedAt: clock.hoursAgo(1),
  };
}

export function pinged(number: number, reason: Extract<Provenance, { kind: 'pinged' }>['reason']): TileMember {
  return { prKey: sampleKey(number), provenance: { kind: 'pinged', reason } };
}

export function pulledIn(number: number, reason: string): TileMember {
  return { prKey: sampleKey(number), provenance: { kind: 'pulled_in', reason } };
}

export function sampleTile(topicId: string, kind: TileKind, id: string, title: string, members: TileMember[]): Tile {
  return { id, topicId, kind, title, members };
}
