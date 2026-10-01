import type { PrTier } from '@postpile/core';

export interface SectionLook {
  label: string;
  text: string;
  dot: string;
}

/**
 * Sidebar section title, dot and count colors, also the topic header's
 * breadcrumb. Honey = aimed at you, ink = yours, sea = your team, grey = the rest.
 */
const SECTION_LOOK: Record<PrTier | 'other', SectionLook> = {
  needs_reply: { label: 'Needs reply', text: 'text-honey-ink', dot: 'bg-honey' },
  changes_requested: { label: 'Changes you requested', text: 'text-honey-ink', dot: 'bg-honey' },
  mine: { label: 'My PRs', text: 'text-ink', dot: 'bg-ink' },
  team: { label: "Team's PRs", text: 'text-sea-ink', dot: 'bg-sea' },
  to_review: { label: 'To review', text: 'text-honey-ink', dot: 'bg-honey' },
  team_mentioned: { label: 'Team mentioned', text: 'text-sea-ink', dot: 'bg-sea-pale' },
  rest: { label: 'Other topics', text: 'text-muted', dot: 'bg-ghost' },
  other: { label: 'Other topics', text: 'text-muted', dot: 'bg-ghost' },
};

/** The look of core's section (`TopicListItem.section`, `TopicDetail.section`); null is Other topics. */
export function sectionLook(section: PrTier | 'other' | null): SectionLook {
  return SECTION_LOOK[section ?? 'other'];
}
