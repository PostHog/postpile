import type { TopicPrStateCounts, TopicPrStateSummary } from '@postpile/core';

const STATE_WORDS: [keyof TopicPrStateCounts, string][] = [
  ['open', 'open'],
  ['merge_queue', 'in merge queue'],
  ['merge_queue_failed', 'failed in merge queue'],
  ['draft', 'draft'],
  ['merged', 'merged'],
  ['closed', 'closed'],
];

/** The state mix of core's counts, most alive first: "3 open · 1 in merge queue · 1 draft · 1 merged". Empty states are left out. */
export function stateMix(counts: TopicPrStateCounts): string {
  return STATE_WORDS.filter(([state]) => counts[state] > 0)
    .map(([state, word]) => `${counts[state]} ${word}`)
    .join(' · ');
}

/**
 * The topic header pill's tooltip from core's rollup: lifecycle mix, then the
 * review mix, then any pulled-in stack layers.
 * "3 open · 1 draft · 1 merged; 2 need review, 1 approved".
 */
export function prMixTitle(rollup: TopicPrStateSummary): string {
  const { reviews } = rollup;
  const reviewParts = [
    reviews.review > 0 ? `${reviews.review} ${reviews.review === 1 ? 'needs' : 'need'} review` : null,
    reviews.changes > 0 ? `${reviews.changes} changes requested` : null,
    reviews.approved > 0 ? `${reviews.approved} approved` : null,
  ].filter((part) => part !== null);
  const layers = rollup.pulledIn > 0 ? `${rollup.pulledIn} pulled-in stack ${rollup.pulledIn === 1 ? 'layer' : 'layers'}` : null;
  return [stateMix(rollup.counts), reviewParts.join(', '), layers].filter((part) => part !== null && part !== '').join('; ');
}
