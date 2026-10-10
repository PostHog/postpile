import type { TopicDetail, TopicListItem } from '@postpile/core';

/** The detail pane's hint while no tile is picked: when every tile is folded away in Dealt with, it says so instead of "Pick a tile". */
export function noSelectionText(detail: TopicDetail | undefined): string {
  if (detail && detail.tiles.length > 0 && detail.tiles.every((view) => view.group === 'dealt_with')) {
    return 'Everything here is dealt with. Open Dealt with to look back.';
  }
  return 'Pick a tile to see it.';
}

/** True when topics exist and none of them needs the user: the sidebar then says so, quietly. */
export function nothingWaits(items: TopicListItem[]): boolean {
  return items.length > 0 && items.every((item) => item.group !== 'needs_you');
}
