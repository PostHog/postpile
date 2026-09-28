import type { TopicListItem, TopicRelation } from '@code-manager/core';

export interface AreaGroup {
  area: string;
  items: TopicListItem[];
}

export interface SidebarGroups {
  /** Topics that need you (`TopicListItem.group`) from every relation. */
  needsYou: TopicListItem[];
  /** The user's team's other topics, by area. */
  team: AreaGroup[];
  routed: TopicListItem[];
  fyi: TopicListItem[];
}

/** Topics without a placement yet (no dossier, Unsorted) go with the team's, under this area. */
export const NO_AREA = 'Other';

const RELATION_LABELS: Record<TopicRelation, string> = { team: 'team', routed: 'routed', fyi: 'FYI' };

export function relationLabel(relation: TopicRelation): string {
  return RELATION_LABELS[relation];
}

function byArea(items: TopicListItem[]): AreaGroup[] {
  const groups = new Map<string, TopicListItem[]>();
  for (const item of items) {
    const area = item.placement?.area ?? NO_AREA;
    groups.set(area, [...(groups.get(area) ?? []), item]);
  }
  // Named areas alphabetically, "Other" last.
  return [...groups]
    .map(([area, members]) => ({ area, items: members }))
    .sort((a, b) => (a.area === NO_AREA ? 1 : b.area === NO_AREA ? -1 : a.area.localeCompare(b.area)));
}

/**
 * The groups inside "Other topics": topics that need you first whatever their
 * relation, then the rest by relation. Unread tiles that are all merged or
 * closed do not count as needing you. Topics keep the API order in a group.
 */
export function sidebarGroups(items: TopicListItem[]): SidebarGroups {
  const quiet = items.filter((item) => item.group !== 'needs_you');
  return {
    needsYou: items.filter((item) => item.group === 'needs_you'),
    team: byArea(quiet.filter((item) => (item.placement?.relation ?? 'team') === 'team')),
    routed: quiet.filter((item) => item.placement?.relation === 'routed'),
    fyi: quiet.filter((item) => item.placement?.relation === 'fyi'),
  };
}
