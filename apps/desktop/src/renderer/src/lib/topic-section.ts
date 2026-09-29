import type { PrTier, TopicQueues } from '@postpile/core';
import type { TelemetryEventProps } from '@postpile/core';
import { TIER_ORDER } from './queues.ts';

type Section = TelemetryEventProps<'topic_opened'>['section'];

/** The telemetry name of each queue section; rest PRs sit in none. */
const SECTIONS: Record<Exclude<PrTier, 'rest'>, Section> = {
  needs_reply: 'needs_reply',
  changes_requested: 'changes_requested',
  mine: 'my_prs',
  team: 'team_prs',
  to_review: 'to_review',
  team_mentioned: 'team_mentioned',
};

/** For topic_opened: which queue section the topic shows under (its highest, in core's tier order), "other" when it sits in none of them. */
export function topicTelemetrySection(queues: TopicQueues): Section {
  const tier = TIER_ORDER.find((candidate) => candidate !== 'rest' && queues.tiers[candidate] > 0);
  return tier && tier !== 'rest' ? SECTIONS[tier] : 'other';
}
