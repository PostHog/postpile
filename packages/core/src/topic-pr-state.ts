// The one PR state icon on a sidebar topic row. Core decides, the renderer
// only draws it (DESIGN.md 2026-10-01 "Sidebar row: PR state icon").
import type { Pr } from './types.ts';

/** Closed means closed without merging. A PR in the merge queue still counts as open. */
export type TopicPrState = 'open' | 'draft' | 'merged' | 'closed';

/** Most alive first: the icon shows the first state with any PR. */
export const TOPIC_PR_STATE_ORDER: TopicPrState[] = ['open', 'draft', 'merged', 'closed'];

export type TopicPrStateCounts = Record<TopicPrState, number>;

/** What the icon needs from one PR of a topic. */
export interface StatedPr extends Pick<Pr, 'state' | 'isDraft'> {
  /** Only pulled into the topic's tiles as a stack layer, never pinged. */
  pulledIn: boolean;
}

export interface TopicPrStateSummary {
  /** The most alive state among the tracked PRs; null when the topic tracks none. */
  state: TopicPrState | null;
  /** Tracked PRs per state, for the tooltip. */
  counts: TopicPrStateCounts;
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
 * One state for the topic by precedence open, draft, merged, closed: one open
 * PR among nine merged shows open, merged shows only when nothing is open or
 * draft, closed only when everything is closed. Pulled-in stack layers are
 * context, not the topic's own PRs, so they count for nothing.
 */
export function topicPrState(prs: StatedPr[]): TopicPrStateSummary {
  const counts: TopicPrStateCounts = { open: 0, draft: 0, merged: 0, closed: 0 };
  for (const pr of prs) {
    if (!pr.pulledIn) {
      counts[stateOf(pr)] += 1;
    }
  }
  const state = TOPIC_PR_STATE_ORDER.find((candidate) => counts[candidate] > 0) ?? null;
  return { state, counts };
}
