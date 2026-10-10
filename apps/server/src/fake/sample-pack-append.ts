// Appends one opt-in sample pack (fake-extras.ts) to the default sample.
import type { FullPr, Glance, PrEvent, PrSet, Tile, Topic, UserPrState } from '@postpile/core';
import type { SampleData } from './sample-data.ts';

/** What a pack adds: the same lists the default sample is built from. */
export interface SamplePack {
  topics: Topic[];
  prs: FullPr[];
  events: PrEvent[];
  glances: Glance[];
  tiles: Tile[];
  sets?: PrSet[];
  userStates?: UserPrState[];
}

/**
 * Adds the pack after the default topics and PRs. Membership follows the
 * default sample's rule: a PR belongs to the topic of the first tile that
 * holds it, and a PR already placed keeps its topic.
 */
export function appendSamplePack(data: SampleData, pack: SamplePack): void {
  data.topics.push(...pack.topics);
  data.prs.push(...pack.prs);
  data.events.push(...pack.events);
  data.glances.push(...pack.glances);
  data.tiles.push(...pack.tiles);
  data.sets.push(...(pack.sets ?? []));
  data.userStates.push(...(pack.userStates ?? []));
  for (const tile of pack.tiles) {
    for (const member of tile.members) {
      if (!data.membership.has(member.prKey)) {
        data.membership.set(member.prKey, tile.topicId);
      }
    }
  }
}
