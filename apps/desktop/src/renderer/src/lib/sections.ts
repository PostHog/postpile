import type { TileView, TopicSection } from '@postpile/core';

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

/** The sections an ask puts a topic in; their names are the PR tiers that ask. */
const ASK_SECTIONS: readonly TopicSection[] = ['needs_reply', 'changes_requested', 'to_review', 'team_mentioned'];

/** The part of a tile `holdingPrLine` reads. */
export type HoldingTile = Pick<TileView, 'group'> & { prs: Pick<TileView['prs'][number], 'key' | 'tier' | 'turn' | 'provenance'>[] };

/**
 * "In Changes you requested: #1963 waits on tove" (BOARD-A-14, owner
 * 2026-10-11): the topic sits in an ask section only because of a PR whose
 * tile is folded away in Dealt with, so the header names it. Null when the
 * section is no ask, or a tile outside Dealt with already shows the ask.
 * Since 2026-10-12 a PR in Changes you requested is never done (core's
 * `changeRequestHoldsOpen`), so it no longer lands here; a read team
 * mention, or a review request the glance calls not yours, still can.
 */
export function holdingPrLine(tiles: HoldingTile[], section: TopicSection): string | null {
  if (!ASK_SECTIONS.includes(section)) {
    return null;
  }
  const holding = tiles.flatMap((view) => view.prs.filter((pr) => pr.provenance.kind !== 'pulled_in' && pr.tier === section).map((pr) => ({ pr, group: view.group })));
  if (holding.length === 0 || holding.some((entry) => entry.group !== 'dealt_with')) {
    return null;
  }
  const { pr } = holding[0]!;
  const number = pr.key.slice(pr.key.lastIndexOf('#'));
  const waits = pr.turn.kind === 'them' && pr.turn.who !== null ? `waits on ${pr.turn.who}` : 'is under Dealt with';
  return `In ${sectionLook(section).label}: ${number} ${waits}`;
}
