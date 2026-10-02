import type { TopicSection } from '@postpile/core';

export interface SectionLook {
  label: string;
  text: string;
  dot: string;
}

/**
 * Sidebar section title, dot and count colors, also the topic header's
 * breadcrumb. Honey = aimed at you, ink = yours, sea = your team, grey = the rest.
 */
const SECTION_LOOK: Record<TopicSection, SectionLook> = {
  needs_reply: { label: 'Needs reply', text: 'text-honey-ink', dot: 'bg-honey' },
  changes_requested: { label: 'Changes you requested', text: 'text-honey-ink', dot: 'bg-honey' },
  to_review: { label: 'To review', text: 'text-honey-ink', dot: 'bg-honey' },
  team_mentioned: { label: 'Team mentioned', text: 'text-sea-ink', dot: 'bg-sea-pale' },
  you_drive: { label: 'You drive', text: 'text-ink', dot: 'bg-ink' },
  team_owns: { label: 'Your team owns', text: 'text-sea-ink', dot: 'bg-sea' },
  other_work: { label: 'Other work', text: 'text-muted', dot: 'bg-faint' },
  other_topics: { label: 'Other topics', text: 'text-muted', dot: 'bg-ghost' },
  archive: { label: 'Archive', text: 'text-muted', dot: 'bg-ghost' },
};

/** The look of core's section (`TopicListItem.section`, `TopicDetail.section`). */
export function sectionLook(section: TopicSection): SectionLook {
  return SECTION_LOOK[section];
}
