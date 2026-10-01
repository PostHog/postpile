// The PR state of a topic and of a tile: the sidebar row's icon, the topic
// header's PR pill and the tile's Draft chip. Core decides, the renderer only
// draws it (DESIGN.md 2026-10-01 "Sidebar row: PR state icon", "Topic header
// PR pill").
import { prStatus, type PrReviewStatus } from './pr-status.ts';
import { pingedPrKeys } from './topic-queues.ts';
import type { Pr, Tile } from './types.ts';
import type { PrSummary } from './views.ts';

/** Closed means closed without merging. A PR in the merge queue still counts as open. */
export type TopicPrState = 'open' | 'draft' | 'merged' | 'closed';

/** Most alive first: the icon shows the first state with any PR. */
export const TOPIC_PR_STATE_ORDER: TopicPrState[] = ['open', 'draft', 'merged', 'closed'];

export type TopicPrStateCounts = Record<TopicPrState, number>;

/** Tracked PRs per review status (`PrStatus.review`): need review, changes requested, approved. */
export type TopicReviewCounts = Record<PrReviewStatus, number>;

/** What the state needs from one PR. */
export interface StatedPr extends Pick<Pr, 'state' | 'isDraft'> {
  /** `PrStatus.review`: null for drafts, merged and closed PRs, and repos without a review rule. */
  review: PrReviewStatus | null;
  /** Only pulled in as a stack layer, never pinged or found: context, not one of the topic's own PRs. */
  pulledIn: boolean;
}

export interface TopicPrStateSummary {
  /** The most alive state among the tracked PRs; null when none is tracked. */
  state: TopicPrState | null;
  /** Tracked PRs per state, for the tooltips. */
  counts: TopicPrStateCounts;
  /** Tracked PRs per review status, for the header pill's tooltip. */
  reviews: TopicReviewCounts;
  /** Every PR passed in, pulled-in layers included: what the tiles show. */
  total: number;
  /** Of those, the pulled-in stack layers. */
  pulledIn: number;
}

function stateOf(pr: StatedPr): TopicPrState {
  if (pr.state === 'MERGED') {
    return 'merged';
  }
  if (pr.state === 'CLOSED') {
    return 'closed';
  }
  return pr.isDraft ? 'draft' : 'open';
}

/**
 * One state for the PRs by precedence open, draft, merged, closed: one open
 * PR among nine merged shows open, merged shows only when nothing is open or
 * draft, closed only when everything is closed. Pulled-in stack layers are
 * context, not the topic's own PRs, so they only count toward `total`. Pass
 * each PR once.
 */
export function topicPrState(prs: StatedPr[]): TopicPrStateSummary {
  const counts: TopicPrStateCounts = { open: 0, draft: 0, merged: 0, closed: 0 };
  const reviews: TopicReviewCounts = { review: 0, changes: 0, approved: 0 };
  let pulledIn = 0;
  for (const pr of prs) {
    if (pr.pulledIn) {
      pulledIn += 1;
      continue;
    }
    counts[stateOf(pr)] += 1;
    if (pr.review !== null) {
      reviews[pr.review] += 1;
    }
  }
  const state = TOPIC_PR_STATE_ORDER.find((candidate) => counts[candidate] > 0) ?? null;
  return { state, counts, reviews, total: prs.length, pulledIn };
}

/**
 * A topic's PR state from its tiles and each of their PRs once. Pinged and
 * found PRs (own open PRs, review requests, recent merges the sync found) are
 * the topic's own; a PR no tile holds as either was only pulled in as a stack
 * layer (`pingedPrKeys`). The sidebar row and the topic header both read this.
 */
export function topicPrRollup(tiles: Tile[], prs: Pr[]): TopicPrStateSummary {
  const tracked = pingedPrKeys(tiles);
  return topicPrState(prs.map((pr) => ({ state: pr.state, isDraft: pr.isDraft, review: prStatus(pr).review, pulledIn: !tracked.has(pr.key) })));
}

/**
 * The tile's Draft chip (grey chip, dashed frame, muted title): its tracked
 * PRs read draft by the same rule as the topic's icon, so some PR is open and
 * every open one is a draft. Pulled-in layers are skipped, so the chip and the
 * topic's draft icon never disagree.
 */
export function isDraftTile(prs: Pick<PrSummary, 'state' | 'isDraft' | 'status' | 'provenance'>[]): boolean {
  const stated = prs.map((pr) => ({ state: pr.state, isDraft: pr.isDraft, review: pr.status.review, pulledIn: pr.provenance.kind === 'pulled_in' }));
  return topicPrState(stated).state === 'draft';
}
