import type { TopicQueues } from '@postpile/core';
import type { TelemetryEventProps } from '@postpile/core';

type Section = TelemetryEventProps<'topic_opened'>['section'];

/** Highest-priority queue tier the topic has an open PR in, same order the sidebar sections show. */
const PRIORITY: { tier: keyof TopicQueues['tiers']; section: Section }[] = [
  { tier: 'needs_reply', section: 'needs_reply' },
  { tier: 'changes_requested', section: 'changes_requested' },
  { tier: 'mine', section: 'my_prs' },
  { tier: 'team', section: 'team_prs' },
  { tier: 'to_review', section: 'to_review' },
  { tier: 'team_mentioned', section: 'team_mentioned' },
];

/** For topic_opened: which queue section the topic shows under (its highest), "other" when it sits in none of them. */
export function topicTelemetrySection(queues: TopicQueues): Section {
  return PRIORITY.find(({ tier }) => queues.tiers[tier] > 0)?.section ?? 'other';
}
